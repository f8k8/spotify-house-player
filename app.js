const express = require('express');
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Check Node.js version (fetch API requires Node.js 18+)
const nodeVersion = process.versions.node.split('.')[0];
if (parseInt(nodeVersion) < 18) {
  console.error('Error: Node.js 18 or higher is required (for native fetch API support)');
  process.exit(1);
}

// Check Chrome executable path is configured
if (!process.env.CHROME_EXECUTABLE_PATH) {
  console.error('Error: CHROME_EXECUTABLE_PATH environment variable is not set');
  console.error('Please set CHROME_EXECUTABLE_PATH in your .env file to the path of your Chrome/Chromium executable');
  process.exit(1);
}

// Check if Chrome executable exists
if (!fs.existsSync(process.env.CHROME_EXECUTABLE_PATH)) {
  console.error(`Error: Chrome executable not found at: ${process.env.CHROME_EXECUTABLE_PATH}`);
  console.error('Please verify the CHROME_EXECUTABLE_PATH in your .env file');
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
 * Get access token for an account (refreshes if expired)
 * GET /api/accounts/:name/token
 */
app.get('/api/accounts/:name/token', async (req, res) => {
  const { name } = req.params;
  const account = accounts[name];

  if (!account) {
    return res.status(404).json({ error: 'Account not found' });
  }

  if (!account.authenticated || !account.token) {
    return res.status(400).json({ error: 'Account not authenticated' });
  }

  // Check if token is expired or about to expire (within 5 minutes)
  const now = Date.now();
  const bufferTime = 5 * 60 * 1000; // 5 minutes in milliseconds
  
  if (account.expiresAt && (now + bufferTime) >= account.expiresAt) {
    // Token is expired or about to expire, refresh it
    if (!account.refreshToken) {
      return res.status(400).json({ error: 'No refresh token available' });
    }

    try {
      const tokenData = await refreshAccessToken(
        account.refreshToken,
        account.clientId,
        account.clientSecret
      );

      // Update account with new token
      const accessToken = tokenData && typeof tokenData.access_token === 'string' ? tokenData.access_token : null;
      const expiresIn = tokenData && typeof tokenData.expires_in === 'number' ? tokenData.expires_in : 3600;
      
      accounts[name] = {
        ...accounts[name],
        token: accessToken,
        expiresAt: Date.now() + (expiresIn * 1000)
      };

      // If a new refresh token is provided, update it
      if (tokenData.refresh_token && typeof tokenData.refresh_token === 'string') {
        accounts[name].refreshToken = tokenData.refresh_token;
      }

      saveTokens();

      return res.json({ token: accessToken });
    } catch (error) {
      console.error('Error refreshing token:', error);
      return res.status(500).json({ error: 'Failed to refresh token', details: error.message });
    }
  }

  // Token is still valid, return it
  res.json({ token: account.token });
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

    // Store tokens - safely update by creating a new object to prevent prototype pollution
    const accessToken = tokenData && typeof tokenData.access_token === 'string' ? tokenData.access_token : null;
    const refreshToken = tokenData && typeof tokenData.refresh_token === 'string' ? tokenData.refresh_token : null;
    const expiresIn = tokenData && typeof tokenData.expires_in === 'number' ? tokenData.expires_in : 3600;
    
    // Update account with validated values
    accounts[accountName] = {
      ...accounts[accountName],
      token: accessToken,
      refreshToken: refreshToken,
      authenticated: true,
      expiresAt: Date.now() + (expiresIn * 1000)
    };

    saveTokens();

    // Escape account name to prevent XSS
    const escapedAccountName = escapeHtml(accountName);

    res.send(`
      <html>
        <head>
          <meta charset="UTF-8">
        </head>
        <body>
          <h1>Authentication Successful!</h1>
          <p>Account "${escapedAccountName}" has been authenticated.</p>
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
 * Body: { accountName: string, displayName: string, audioDestination: string }
 */
app.post('/api/players/:name/launch', async (req, res) => {
  const { name } = req.params;
  const { accountName, displayName, audioDestination } = req.body;

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
    const browser = await launchPlayerInstance(name, account.token, displayName, audioDestination);
    playerInstances.set(name, {
      browser,
      audioDestination: audioDestination || 'default',
      displayName: displayName || name,
      launchedAt: new Date()
    });

    res.json({
      message: 'Player instance launched successfully',
      name,
      displayName: displayName || name,
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
    displayName: instance.displayName || name,
    audioDestination: instance.audioDestination,
    launchedAt: instance.launchedAt
  }));
  res.json({ players });
});

// Helper function to escape HTML entities to prevent XSS
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

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

// Helper function to refresh an access token
async function refreshAccessToken(refreshToken, clientId, clientSecret) {
  const tokenUrl = 'https://accounts.spotify.com/api/token';
  
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken
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
    throw new Error(`Token refresh failed: ${error}`);
  }

  return await response.json();
}

// Helper function to launch a player instance in headless browser
async function launchPlayerInstance(accountName, accessToken, displayName, audioDestination) {
  // Allow running in non-headless mode for debugging
  const headless = process.env.DEBUG_HEADLESS !== 'false';
  
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_EXECUTABLE_PATH,
    headless: headless,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      audioDestination ? `--audio-output-device=${audioDestination}` : ''
    ].filter(Boolean),
    ignoreDefaultArgs: ["--mute-audio", "--hide-scrollbars"],
  });

  const page = await browser.newPage();

  // Set the access token in page context
  await page.evaluateOnNewDocument((token) => {
    window.SPOTIFY_ACCESS_TOKEN = token;
  }, accessToken);

  // Navigate to player page
  const playerName = displayName || accountName;
  const playerUrl = `http://localhost:${PORT}/player.html?playerName=${encodeURIComponent(playerName)}&accountName=${encodeURIComponent(accountName)}`;
  await page.goto(playerUrl, { waitUntil: 'networkidle2' });

  console.log(`Player instance launched for account: ${accountName} with display name: ${playerName}`);

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
