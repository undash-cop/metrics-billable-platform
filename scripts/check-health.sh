#!/bin/bash
# Health Check Script
# Checks the health of the billing platform

set -e

BASE_URL="${1:-http://localhost:8787}"
ADMIN_API_KEY="${ADMIN_API_KEY}"

echo "Health Check for: $BASE_URL"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check health endpoint
echo -n "Checking health endpoint... "
health_response=$(curl -s -w "\n%{http_code}" "$BASE_URL/health" || echo -e "\n000")
health_code=$(echo "$health_response" | tail -n1)
health_body=$(echo "$health_response" | sed '$d')

if [ "$health_code" = "200" ]; then
  echo -e "${GREEN}✓${NC}"
else
  echo -e "${RED}✗${NC} (HTTP $health_code)"
  echo "  Response: $health_body"
fi

# Check admin API (if API key provided)
if [ -n "$ADMIN_API_KEY" ]; then
  echo -n "Checking admin API... "
  admin_response=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $ADMIN_API_KEY" \
    "$BASE_URL/api/v1/admin/organisations" || echo -e "\n000")
  admin_code=$(echo "$admin_response" | tail -n1)
  
  if [ "$admin_code" = "200" ] || [ "$admin_code" = "404" ]; then
    echo -e "${GREEN}✓${NC}"
  else
    echo -e "${RED}✗${NC} (HTTP $admin_code)"
    if [ "$admin_code" = "401" ]; then
      echo "  Authentication failed - check API key"
    fi
  fi
else
  echo -e "${YELLOW}⚠${NC} Skipping admin API check (no ADMIN_API_KEY)"
fi

# Check database (if DATABASE_URL provided)
if [ -n "$DATABASE_URL" ]; then
  echo -n "Checking database connection... "
  db_check=$(psql "$DATABASE_URL" -t -c "SELECT 1;" 2>&1)
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓${NC}"
    
    # Check pending migrations
    echo -n "Checking pending events... "
    pending=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM usage_events WHERE processed_at IS NULL;" 2>/dev/null || echo "0")
    if [ -n "$pending" ]; then
      echo -e "${YELLOW}⚠${NC} $pending pending events"
    else
      echo -e "${GREEN}✓${NC}"
    fi
  else
    echo -e "${RED}✗${NC}"
    echo "  Error: $db_check"
  fi
else
  echo -e "${YELLOW}⚠${NC} Skipping database check (no DATABASE_URL)"
fi

echo ""
echo "Health check complete!"
