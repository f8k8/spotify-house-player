# Spotify House Player

A Node.js application that uses the Spotify Web Playback SDK in headless browsers to create multiple player instances, each authenticated with different Spotify accounts. Uses Puppeteer to manage browser instances and provides a REST API for controlling players.

## Features

- 🎵 Multiple Spotify player instances running simultaneously
- 🔐 OAuth authentication for each account
- 🎧 Configurable audio destination per player
- 🤖 Headless browser-based playback using Puppeteer
- 🔌 REST API for managing accounts and players
- 💾 Persistent token storage
- 🏠 Home Assistant integration with automatic webhook notifications

## Prerequisites

- Node.js (v18 or higher) - Required for native fetch API support
- Chrome or Chromium browser installed on your system
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

### 3. Configure Environment

Copy `.env.example` to `.env` and customize:

```bash
cp .env.example .env
```

Available environment variables:
- `CHROME_EXECUTABLE_PATH` - **Required** - Path to Chrome/Chromium executable
  - Linux: `/usr/bin/google-chrome` or `/usr/bin/chromium`
  - macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
  - Windows: `C:\Program Files\Google\Chrome\Application\chrome.exe`
- `PORT` - Server port (default: 3000)
- `DEBUG_HEADLESS` - Set to `false` to run Chrome instances in visible windows for debugging (default: true)
- `HA_URL` - Optional - Home Assistant URL (e.g., `http://homeassistant.local:8123`)
- `HA_TOKEN` - Optional - Home Assistant long-lived access token

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
    "redirectUri": "http://localhost:3000/callback",
    "haSourceId": "Spotify Living Room"
  }'
```

Parameters:
- `name` - Unique identifier for the account
- `clientId` - Spotify app client ID
- `clientSecret` - Spotify app client secret
- `redirectUri` - OAuth redirect URI (default: `http://localhost:3000/callback`)
- `haSourceId` - Optional - Home Assistant source name for this account

Response will include an `authUrl` that you need to visit to authenticate.

### 2. Authenticate the Account

Visit the `authUrl` returned from the previous step in your browser. You'll be redirected to Spotify to authorize the app. After authorization, you'll be redirected back to the callback URL and the token will be stored.

### 3. Launch a Player Instance

Start a headless browser player for the account:

```bash
curl -X POST http://localhost:3000/api/players/living-room/launch \
  -H "Content-Type: application/json" \
  -d '{
    "accountName": "living-room",
    "displayName": "Living Room Speaker",
    "audioDestination": "default",
    "haEntityId": "media_player.living_room_amplifier"
  }'
```

Parameters:
- `accountName` - Name of the account to use
- `displayName` - Display name for the Spotify device
- `audioDestination` - Audio output device (default: `"default"`)
- `haEntityId` - Optional - Home Assistant media player entity ID

The player will now be available in your Spotify app as a device with the specified display name (e.g., "Living Room Speaker").

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

## Home Assistant Integration

This application can automatically notify Home Assistant when playback starts or stops on a player. This is useful for automating speaker/amplifier power management and source selection.

### Setup

1. **Create a Long-Lived Access Token in Home Assistant**:
   - Go to your Home Assistant profile page
   - Scroll to "Long-Lived Access Tokens"
   - Click "Create Token"
   - Copy the generated token

2. **Configure Environment Variables**:
   Add to your `.env` file:
   ```
   HA_URL=http://homeassistant.local:8123
   HA_TOKEN=your_long_lived_access_token_here
   ```

3. **Configure Your Accounts and Players**:
   - When adding an account, specify the `haSourceId` parameter (the source name your HA media player should select)
   - When launching a player, specify the `haEntityId` parameter (the entity ID of your HA media player)

### How It Works

When playback starts on a player:
1. The player detects the state change
2. It notifies the backend via `/api/players/:name/playback-started`
3. The backend calls Home Assistant to:
   - Turn on the media player (using `media_player.turn_on` service)
   - Set its source to the configured `haSourceId` (using `media_player.select_source` service)

When playback stops on a player:
1. The player detects the state change (when playback ends or the queue is empty)
2. It notifies the backend via `/api/players/:name/playback-stopped`
3. The backend calls Home Assistant to:
   - Turn off the media player (using `media_player.turn_off` service)

This ensures your amplifier/receiver automatically switches to the correct input when you start playing music, and turns off when playback stops, providing complete automated power management.

### Example Configuration

```bash
# Add account with HA source ID
curl -X POST http://localhost:3000/api/accounts \
  -H "Content-Type: application/json" \
  -d '{
    "name": "living-room",
    "clientId": "YOUR_CLIENT_ID",
    "clientSecret": "YOUR_CLIENT_SECRET",
    "haSourceId": "Spotify Living Room"
  }'

# Launch player with HA entity ID
curl -X POST http://localhost:3000/api/players/living-room/launch \
  -H "Content-Type: application/json" \
  -d '{
    "accountName": "living-room",
    "displayName": "Living Room Speaker",
    "haEntityId": "media_player.living_room_amplifier"
  }'
```

Now when you use the "Living Room Speaker" device in Spotify:
1. **On playback start**: Your Home Assistant media player `media_player.living_room_amplifier` will be turned on and its source will be set to "Spotify Living Room"
2. **On playback stop**: Your Home Assistant media player will be automatically turned off

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
| `POST` | `/api/players/:name/playback-started` | Internal endpoint called by player when playback starts |
| `POST` | `/api/players/:name/playback-stopped` | Internal endpoint called by player when playback stops |

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
- For production use, consider adding rate limiting middleware (e.g., express-rate-limit) to prevent abuse
- XSS protection is implemented for user-provided values in HTML responses

## Troubleshooting

### Debugging with Visible Browser Windows

For debugging purposes, you can run the Chrome instances in visible windows instead of headless mode:

1. Set the `DEBUG_HEADLESS` environment variable to `false` in your `.env` file
2. Restart the server
3. Launch a player instance - you'll see the Chrome window open and the player page load

This is useful for:
- Debugging player initialization issues
- Inspecting the Web Playback SDK state
- Viewing console logs in the browser's DevTools

**Note:** When `DEBUG_HEADLESS=false`, you need a display environment (not suitable for headless servers).

### Chrome Executable Path Issues

This application uses `puppeteer-core`, which requires you to specify the path to an installed Chrome or Chromium browser via the `CHROME_EXECUTABLE_PATH` environment variable.

If you encounter issues with Chrome not being found:

1. Verify that Chrome or Chromium is installed on your system
2. Locate the Chrome executable path:
   - Linux: Try `/usr/bin/google-chrome`, `/usr/bin/chromium`, or `/usr/bin/chromium-browser`
   - macOS: Try `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
   - Windows: Try `C:\Program Files\Google\Chrome\Application\chrome.exe` or `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`
3. Update the `CHROME_EXECUTABLE_PATH` in your `.env` file with the correct path
4. Restart the server

To find Chrome on Linux/macOS:
```bash
which google-chrome chromium chromium-browser
```

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