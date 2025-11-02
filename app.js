const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Check Node.js version (fetch API requires Node.js 18+)
const nodeVersion = process.versions.node.split('.')[0];
if (parseInt(nodeVersion) < 18) {
  console.error('Error: Node.js 18 or higher is required (for native fetch API support)');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Store for account data
const TOKENS_FILE = path.join(__dirname, 'tokens.json');
let accounts = {};

// Load existing tokens if available
if (fs.existsSync(TOKENS_FILE)) {
  try {
    accounts = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
  } catch (error) {
    console.error('Error loading tokens:', error);
    accounts = {};
  }
}

// Save tokens to file
function saveTokens() {
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(accounts, null, 2));
}

// Store for browser instances
const playerInstances = new Map();

/**
 * Add a new account endpoint
 * POST /api/accounts
 * Body: { name: string, clientId: string, clientSecret: string, redirectUri: string }
 */
app.post('/api/accounts', async (req, res) => {
  const { name, clientId, clientSecret, redirectUri } = req.body;

  if (!name || !clientId || !clientSecret) {
    return res.status(400).json({ error: 'Name, clientId, and clientSecret are required' });
  }

  if (accounts[name]) {
    return res.status(409).json({ error: 'Account with this name already exists' });
  }

  // Store account credentials
  accounts[name] = {
    name,
    clientId,
    clientSecret,
    redirectUri: redirectUri || 'http://localhost:3000/callback',
    authenticated: false,
    token: null,
    refreshToken: null
  };

  saveTokens();

  // Generate authorization URL
  const authUrl = generateAuthUrl(clientId, redirectUri || 'http://localhost:3000/callback', name);

  res.json({
    message: 'Account added successfully',
    name,
    authUrl,
    instructions: 'Visit the authUrl to authenticate with Spotify'
  });
});

/**
 * List all accounts
 * GET /api/accounts
 */
app.get('/api/accounts', (req, res) => {
  const accountList = Object.keys(accounts).map(name => ({
    name,
    authenticated: accounts[name].authenticated,
    hasPlayer: playerInstances.has(name)
  }));
  res.json({ accounts: accountList });
});

/**
 * Get specific account
 * GET /api/accounts/:name
 */
app.get('/api/accounts/:name', (req, res) => {
  const { name } = req.params;
  const account = accounts[name];

  if (!account) {
    return res.status(404).json({ error: 'Account not found' });
  }

  res.json({
    name: account.name,
    authenticated: account.authenticated,
    hasPlayer: playerInstances.has(name)
  });
});

/**
 * Callback endpoint for OAuth
 * GET /callback?code=...&state=...
 */
app.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  const accountName = state;

  if (!code || !accountName || !accounts[accountName]) {
    return res.status(400).send('Invalid callback parameters');
  }

  try {
    // Exchange code for token
    const tokenData = await exchangeCodeForToken(
      code,
      accounts[accountName].clientId,
      accounts[accountName].clientSecret,
      accounts[accountName].redirectUri
    );

    // Store tokens
    accounts[accountName].token = tokenData.access_token;
    accounts[accountName].refreshToken = tokenData.refresh_token;
    accounts[accountName].authenticated = true;
    accounts[accountName].expiresAt = Date.now() + (tokenData.expires_in * 1000);

    saveTokens();

    res.send(`
      <html>
        <body>
          <h1>Authentication Successful!</h1>
          <p>Account "${accountName}" has been authenticated.</p>
          <p>You can close this window and launch the player instance.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Error exchanging code for token:', error);
    res.status(500).send('Failed to authenticate');
  }
});

/**
 * Launch player instance for an account
 * POST /api/players/:name/launch
 * Body: { audioDestination: string }
 */
app.post('/api/players/:name/launch', async (req, res) => {
  const { name } = req.params;
  const { audioDestination } = req.body;

  const account = accounts[name];

  if (!account) {
    return res.status(404).json({ error: 'Account not found' });
  }

  if (!account.authenticated || !account.token) {
    return res.status(400).json({ error: 'Account not authenticated. Please authenticate first.' });
  }

  if (playerInstances.has(name)) {
    return res.status(409).json({ error: 'Player instance already running for this account' });
  }

  try {
    // Launch headless browser with player
    const browser = await launchPlayerInstance(name, account.token, audioDestination);
    playerInstances.set(name, {
      browser,
      audioDestination: audioDestination || 'default',
      launchedAt: new Date()
    });

    res.json({
      message: 'Player instance launched successfully',
      name,
      audioDestination: audioDestination || 'default'
    });
  } catch (error) {
    console.error('Error launching player:', error);
    res.status(500).json({ error: 'Failed to launch player instance', details: error.message });
  }
});

/**
 * Stop player instance for an account
 * DELETE /api/players/:name
 */
app.delete('/api/players/:name', async (req, res) => {
  const { name } = req.params;

  if (!playerInstances.has(name)) {
    return res.status(404).json({ error: 'No player instance running for this account' });
  }

  try {
    const instance = playerInstances.get(name);
    await instance.browser.close();
    playerInstances.delete(name);

    res.json({ message: 'Player instance stopped successfully', name });
  } catch (error) {
    console.error('Error stopping player:', error);
    res.status(500).json({ error: 'Failed to stop player instance', details: error.message });
  }
});

/**
 * List all running player instances
 * GET /api/players
 */
app.get('/api/players', (req, res) => {
  const players = Array.from(playerInstances.entries()).map(([name, instance]) => ({
    name,
    audioDestination: instance.audioDestination,
    launchedAt: instance.launchedAt
  }));
  res.json({ players });
});

// Helper function to generate Spotify authorization URL
function generateAuthUrl(clientId, redirectUri, accountName) {
  const scopes = [
    'streaming',
    'user-read-email',
    'user-read-private',
    'user-read-playback-state',
    'user-modify-playback-state'
  ].join(' ');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: scopes,
    redirect_uri: redirectUri,
    state: accountName
  });

  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

// Helper function to exchange authorization code for access token
async function exchangeCodeForToken(code, clientId, clientSecret, redirectUri) {
  const tokenUrl = 'https://accounts.spotify.com/api/token';
  
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri
  });

  const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${authHeader}`
    },
    body: params.toString()
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  return await response.json();
}

// Helper function to launch a player instance in headless browser
async function launchPlayerInstance(accountName, accessToken, audioDestination) {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      audioDestination ? `--audio-output-device=${audioDestination}` : ''
    ].filter(Boolean)
  });

  const page = await browser.newPage();

  // Set the access token in page context
  await page.evaluateOnNewDocument((token) => {
    window.SPOTIFY_ACCESS_TOKEN = token;
  }, accessToken);

  // Navigate to player page
  const playerUrl = `http://localhost:${PORT}/player.html?account=${accountName}`;
  await page.goto(playerUrl, { waitUntil: 'networkidle2' });

  console.log(`Player instance launched for account: ${accountName}`);

  return browser;
}

// Serve player HTML page
app.get('/player.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'player.html'));
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Spotify House Player API',
    endpoints: {
      'POST /api/accounts': 'Add a new account',
      'GET /api/accounts': 'List all accounts',
      'GET /api/accounts/:name': 'Get account details',
      'POST /api/players/:name/launch': 'Launch player for account',
      'DELETE /api/players/:name': 'Stop player for account',
      'GET /api/players': 'List running players',
      'GET /callback': 'OAuth callback (used internally)'
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Spotify House Player server running on port ${PORT}`);
  console.log(`API available at http://localhost:${PORT}`);
});

// Cleanup on shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  for (const [name, instance] of playerInstances) {
    console.log(`Closing player instance for ${name}`);
    await instance.browser.close();
  }
  process.exit(0);
});
