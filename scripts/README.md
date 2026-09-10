# NurChat Scripts

## backup.sh

Automated SQLite database backup script.

### Usage
```bash
./scripts/backup.sh
```

### Features
- Creates timestamped backups in `backup/` directory
- Keeps last 7 daily backups
- Uses SQLite `.backup` command when available, falls back to file copy

### Cron Example
```bash
# Daily backup at 2 AM
0 2 * * * /path/to/nurchat/scripts/backup.sh
```

## Load Testing

### test/load_test_ws.py
WebSocket load test for 100+ concurrent connections.

```bash
python test/load_test_ws.py
```

### test/load_test_websocket.py
Simple WebSocket load test (existing).
