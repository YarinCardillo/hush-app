# Synapse Configuration

This directory contains the Matrix Synapse homeserver configuration for Hush.

## Files

- `homeserver.yaml.template` - Configuration template with placeholders
- `homeserver.yaml` - Generated configuration (not in git)
- `data/` - Runtime data directory (not in git)
- `MATRIX_SERVER_NAME.log.config` - Logging configuration

## Setup

1. **Generate configuration:**
   ```bash
   ./scripts/generate-synapse-config.sh
   ```

2. **Customize (optional):**
   Edit `.env` to override default values:
   ```bash
   MATRIX_SERVER_NAME=localhost
   MATRIX_PUBLIC_BASEURL=http://localhost:8008
   POSTGRES_USER=synapse
   POSTGRES_PASSWORD=synapse_password
   POSTGRES_DB=synapse
   ```

3. **Start services:**
   ```bash
   docker-compose up -d
   ```

4. **Verify Synapse is running:**
   ```bash
   curl http://localhost:8008/_matrix/client/versions
   ```

## Key Features

- **PostgreSQL backend** - Production-ready persistence
- **Guest access enabled** - No registration required for guests
- **E2EE support** - End-to-end encryption via Olm/Megolm
- **Open registration** - Users can create accounts without email verification

## Security Notes

- The generated `homeserver.yaml` contains secrets and should NOT be committed to git
- Signing keys are generated automatically and stored in `data/`
- Change default PostgreSQL credentials in production deployments

## Troubleshooting

### Config file '/data/homeserver.yaml' does not exist

This error occurs after a database wipe (`docker-compose down -v` or `rm -rf synapse/data`).

**Root cause:** The Synapse Docker image no longer generates config from environment variables. All config files must exist in `synapse/data/` before starting.

**Solution:**
```bash
./scripts/generate-synapse-config.sh
docker-compose restart synapse
```

### Error reading signing_key: Unsupported algorithm -----BEGIN

**Root cause:** The signing key is in PEM format, but Synapse requires a specific format.

**Required format:** `ed25519 a_<keyid> <base64_key>`

**Solution:** Delete the invalid key and regenerate:
```bash
rm synapse/data/*.signing.key
./scripts/generate-synapse-config.sh
docker-compose restart synapse
```

### 502 Bad Gateway on Matrix endpoints

**Possible causes:**
1. Docker Desktop not running
2. Synapse container in restart loop (check with `docker-compose ps`)
3. Missing config files in `synapse/data/`

**Diagnosis:**
```bash
docker-compose ps
docker-compose logs synapse --tail=50
```

### Database Wipe Procedure

When you need to clear all Matrix data (e.g., stale encrypted rooms):

```bash
# Stop all containers and remove volumes
docker-compose down -v

# Remove local data (config will need regeneration)
rm -rf synapse/data

# Regenerate config
./scripts/generate-synapse-config.sh

# Start services
docker-compose up -d

# Wait for initialization (30-60 seconds)
sleep 30

# Verify health
curl http://localhost:80/_matrix/client/versions
```

## Data Directory Structure

After running `generate-synapse-config.sh`, the `data/` directory should contain:

```
data/
├── homeserver.yaml          # Main config (required)
├── localhost.signing.key    # Ed25519 signing key (required)
├── localhost.log.config     # Logging config (required)
└── media_store/             # Uploaded media (auto-created)
```

If any of these files are missing, Synapse will fail to start.
