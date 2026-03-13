/**
 * Asset Download Script for Dance Floor Destruction
 * Downloads CC0 assets from Kenney.nl
 */

import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, rmdirSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const publicDir = path.join(rootDir, 'public');

// Asset configurations - using direct download links from Kenney
const ASSETS = [
  {
    name: 'Blaster Kit',
    url: 'https://kenney.nl/media/pages/assets/blaster-kit/d0d6d3f197-1677495729/kenney_blaster-kit.zip',
    targetDir: 'weapons',
    description: 'FPS weapon models'
  },
  {
    name: 'Shape Characters',
    url: 'https://kenney.nl/media/pages/assets/shape-characters/23913fadc9-1677495735/kenney_shape-characters.zip',
    targetDir: 'items',
    description: 'Coins and powerup shapes'
  }
];

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function ensureDir(dirPath) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
    log(`  Created directory: ${dirPath}`, 'cyan');
  }
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    log(`  Downloading from: ${url}`, 'cyan');
    
    const makeRequest = (requestUrl, redirectCount = 0) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'));
        return;
      }

      const protocol = requestUrl.startsWith('https') ? https : http;
      
      protocol.get(requestUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }, (response) => {
        // Handle redirects
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          log(`  Following redirect to: ${response.headers.location}`, 'yellow');
          makeRequest(response.headers.location, redirectCount + 1);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: Failed to download ${url}`));
          return;
        }

        const file = createWriteStream(destPath);
        response.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve();
        });

        file.on('error', (err) => {
          unlinkSync(destPath);
          reject(err);
        });
      }).on('error', reject);
    };

    makeRequest(url);
  });
}

async function extractZip(zipPath, targetDir) {
  log(`  Extracting to: ${targetDir}`, 'cyan');
  
  // Use PowerShell on Windows to extract
  const command = process.platform === 'win32'
    ? `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${targetDir}' -Force"`
    : `unzip -o "${zipPath}" -d "${targetDir}"`;

  try {
    await execPromise(command);
    log(`  Extracted successfully`, 'green');
  } catch (error) {
    throw new Error(`Failed to extract ${zipPath}: ${error.message}`);
  }
}

function cleanupZip(zipPath) {
  if (existsSync(zipPath)) {
    unlinkSync(zipPath);
    log(`  Cleaned up: ${path.basename(zipPath)}`, 'cyan');
  }
}

async function downloadAndExtract(asset) {
  const targetDir = path.join(publicDir, asset.targetDir);
  const zipPath = path.join(publicDir, `${asset.targetDir}.zip`);

  log(`\n▶ ${asset.name} (${asset.description})`, 'magenta');

  // Create target directory
  ensureDir(targetDir);

  try {
    // Download
    await downloadFile(asset.url, zipPath);
    log(`  Downloaded: ${asset.name}`, 'green');

    // Extract
    await extractZip(zipPath, targetDir);

    // Cleanup
    cleanupZip(zipPath);

    return true;
  } catch (error) {
    log(`  ERROR: ${error.message}`, 'red');
    cleanupZip(zipPath);
    return false;
  }
}

function createPlaceholderAssets() {
  log('\n▶ Creating procedural assets (no external download needed)', 'magenta');

  // These will be created by the game itself using Three.js primitives
  // Just ensure directories exist
  const dirs = ['weapons', 'environment', 'sounds', 'ui', 'items', 'models'];
  dirs.forEach(dir => {
    ensureDir(path.join(publicDir, dir));
  });

  // Create a manifest file to track what's available
  const manifest = {
    created: new Date().toISOString(),
    assets: {
      weapons: 'Procedural weapon geometry',
      environment: 'Procedural arena',
      items: 'Procedural coins and powerups',
      sounds: 'Web Audio API synthesized sounds',
      ui: 'CSS-based UI'
    },
    note: 'This game uses procedural generation for assets to avoid external dependencies'
  };

  fs.writeFileSync(
    path.join(publicDir, 'asset-manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  log('  Asset directories created', 'green');
  log('  Manifest written', 'green');
}

async function main() {
  console.log('\n' + '='.repeat(60));
  log('  DANCE FLOOR DESTRUCTION - Asset Setup', 'cyan');
  console.log('='.repeat(60));

  // Ensure public directory exists
  ensureDir(publicDir);

  // Create all necessary directories
  createPlaceholderAssets();

  // Try to download Kenney assets (optional - game works without them)
  let downloadedCount = 0;
  let failedCount = 0;

  log('\n▶ Attempting to download CC0 assets from Kenney.nl', 'yellow');
  log('  (Game will work with procedural assets if downloads fail)', 'yellow');

  for (const asset of ASSETS) {
    const success = await downloadAndExtract(asset);
    if (success) {
      downloadedCount++;
    } else {
      failedCount++;
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  log('  SETUP COMPLETE', 'green');
  console.log('='.repeat(60));
  
  log(`\n  Downloaded: ${downloadedCount}/${ASSETS.length} asset packs`, downloadedCount > 0 ? 'green' : 'yellow');
  
  if (failedCount > 0) {
    log(`  Failed: ${failedCount} (game will use procedural alternatives)`, 'yellow');
  }

  log('\n  The game is ready to run!', 'green');
  log('  Run: npm run dev', 'cyan');
  console.log('\n');
}

main().catch(error => {
  log(`\nFATAL ERROR: ${error.message}`, 'red');
  process.exit(1);
});
