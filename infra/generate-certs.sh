#!/bin/bash
# Generate self-signed certificates for development ONLY.
# For production, use Let's Encrypt or a real CA.
set -e

CERT_DIR="$(dirname "$0")/certs"
mkdir -p "$CERT_DIR"

openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout "$CERT_DIR/privkey.pem" \
  -out "$CERT_DIR/fullchain.pem" \
  -subj "/C=US/ST=Dev/L=Dev/O=NurChat/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

echo "Self-signed certs generated in $CERT_DIR"
echo "WARNING: For production, use Let's Encrypt (certbot) or a real CA."
