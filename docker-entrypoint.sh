#!/bin/sh
set -e

echo "Waiting for database to be ready..."
sleep 5

echo "Checking if database needs initialization..."

# Try to query the modules table - if it fails, we need to initialize
if echo "SELECT 1 FROM modules LIMIT 1;" | npx prisma db execute --stdin > /dev/null 2>&1; then
  echo "Database already initialized, skipping prisma db push"
else
  echo "Fresh database detected, running prisma db push..."
  npx prisma db push --skip-generate
fi

echo "Starting bot..."
exec node dist/index.js
