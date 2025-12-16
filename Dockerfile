# Use Node.js 18 LTS as base image
FROM node:18-slim

# Install Chrome dependencies and audio libraries
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libwayland-client0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    libu2f-udev \
    libvulkan1 \
    pulseaudio \
    alsa-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Install Chromium browser
RUN apt-get update \
    && apt-get install -y chromium --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install app dependencies as root
# Using npm install instead of npm ci to avoid npm bug in Docker builds
RUN npm install --omit=dev

# Copy app source (excluding node_modules which is already installed)
COPY app.js .
COPY .env.example .
COPY public ./public

# Run as non-root user for security (create user and transfer ownership)
RUN groupadd -r appuser && useradd -r -g appuser -m -d /home/appuser appuser \
    && chown -R appuser:appuser /app

# Switch to app user
USER appuser

# Create volume mount point for persistent token storage
VOLUME ["/app/data"]

# Expose the application port
EXPOSE 3000

# Set default Chrome executable path
ENV CHROME_EXECUTABLE_PATH=/usr/bin/chromium

# Start the application
CMD ["node", "app.js"]
