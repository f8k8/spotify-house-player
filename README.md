# Spotify House Player

A Node.js application that uses the Spotify Web Playback SDK in headless browsers to create multiple player instances, each authenticated with different Spotify accounts. Uses Puppeteer to manage browser instances and provides a REST API for controlling players.

## Features

- 🎵 Multiple Spotify player instances running simultaneously
- 🔐 OAuth authentication for each account
- 🎧 Configurable audio destination per player
- 🤖 Headless browser-based playback using Puppeteer
- 🔌 REST API for managing accounts and players
- 💾 Persistent token storage

## Prerequisites

- Node.js (v16 or higher)
- A Spotify Premium account (required for Web Playback SDK)
- Spotify Developer App credentials (Client ID and Client Secret)

## Setup

### 1. Create a Spotify Developer App

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create a new app
3. Note your Client ID and Client Secret
4. Add `http://localhost:3000/callback` to your Redirect URIs in the app settings

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment (Optional)

Copy `.env.example` to `.env` and customize if needed:

```bash
cp .env.example .env
```

### 4. Start the Server

```bash
npm start
```

The server will start on `http://localhost:3000` (or the port specified in your `.env` file).

## Usage

### 1. Add a New Account

Add a Spotify account to the system:

```bash
curl -X POST http://localhost:3000/api/accounts \
  -H "Content-Type: application/json" \
  -d '{
    "name": "living-room",
    "clientId": "YOUR_SPOTIFY_CLIENT_ID",
    "clientSecret": "YOUR_SPOTIFY_CLIENT_SECRET",
    "redirectUri": "http://localhost:3000/callback"
  }'
```

Response will include an `authUrl` that you need to visit to authenticate.

### 2. Authenticate the Account

Visit the `authUrl` returned from the previous step in your browser. You'll be redirected to Spotify to authorize the app. After authorization, you'll be redirected back to the callback URL and the token will be stored.

### 3. Launch a Player Instance

Start a headless browser player for the account:

```bash
curl -X POST http://localhost:3000/api/players/living-room/launch \
  -H "Content-Type: application/json" \
  -d '{
    "audioDestination": "default"
  }'
```

The player will now be available in your Spotify app as a device named "Spotify House Player - living-room".

### 4. Control Playback

Use the Spotify app on your phone or computer to select the player device and start playing music. The audio will play through the configured audio destination on the server.

### 5. List Players and Accounts

```bash
# List all accounts
curl http://localhost:3000/api/accounts

# Get specific account
curl http://localhost:3000/api/accounts/living-room

# List running players
curl http://localhost:3000/api/players
```

### 6. Stop a Player

```bash
curl -X DELETE http://localhost:3000/api/players/living-room
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | API information and endpoint list |
| `POST` | `/api/accounts` | Add a new account |
| `GET` | `/api/accounts` | List all accounts |
| `GET` | `/api/accounts/:name` | Get account details |
| `POST` | `/api/players/:name/launch` | Launch player for account |
| `DELETE` | `/api/players/:name` | Stop player for account |
| `GET` | `/api/players` | List running players |

## Audio Destination Configuration

The `audioDestination` parameter in the launch endpoint can be used to specify which audio output device to use. The value depends on your system:

- `"default"` - Use the default audio device
- On Linux: Device identifier like `"hw:0,0"` or `"pulse"`
- On macOS: Device name or identifier
- On Windows: Device name or identifier

To list available audio devices on your system, you can use system-specific commands:
- Linux: `aplay -L` or `pactl list sinks`
- macOS: `system_profiler SPAudioDataType`
- Windows: Check Sound settings in Control Panel

## Security Notes

- Tokens are stored in `tokens.json` - keep this file secure and never commit it to version control
- The `.gitignore` file is configured to exclude sensitive files
- Client secrets should be kept secure and not shared
- This is intended for personal/private use on trusted networks

## Troubleshooting

### Puppeteer Browser Issues

If you encounter issues with Puppeteer not finding a browser, you may need to install Chromium:

```bash
npx puppeteer browsers install chrome
```

Alternatively, you can use the system Chrome by setting the `executablePath` option in the Puppeteer launch configuration.

### Audio Not Playing

- Ensure your Spotify account has Premium (required for Web Playback SDK)
- Check that the audio destination is correctly configured
- Verify that the server has permissions to access audio devices
- On headless systems, ensure ALSA/PulseAudio is properly configured

### Authentication Errors

- Verify your Spotify app credentials are correct
- Ensure the redirect URI in your Spotify app settings matches exactly
- Check that the authorization callback was completed successfully

## License

ISC