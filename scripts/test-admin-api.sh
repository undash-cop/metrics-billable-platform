#!/bin/bash
# Test Admin API Endpoints
# Usage: ./scripts/test-admin-api.sh <admin-api-key> <base-url>

set -e

ADMIN_API_KEY="${1:-${ADMIN_API_KEY}}"
BASE_URL="${2:-http://localhost:8787}"

if [ -z "$ADMIN_API_KEY" ]; then
  echo "Error: Admin API key required"
  echo "Usage: $0 <admin-api-key> [base-url]"
  echo "   or: ADMIN_API_KEY=your-key $0 [base-url]"
  exit 1
fi

echo "Testing Admin API at: $BASE_URL"
echo "Using API key: ${ADMIN_API_KEY:0:10}..."
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Test function
test_endpoint() {
  local method=$1
  local endpoint=$2
  local data=$3
  local description=$4
  
  echo -n "Testing $description... "
  
  if [ -n "$data" ]; then
    response=$(curl -s -w "\n%{http_code}" -X "$method" \
      "$BASE_URL$endpoint" \
      -H "Authorization: Bearer $ADMIN_API_KEY" \
      -H "Content-Type: application/json" \
      -d "$data")
  else
    response=$(curl -s -w "\n%{http_code}" -X "$method" \
      "$BASE_URL$endpoint" \
      -H "Authorization: Bearer $ADMIN_API_KEY")
  fi
  
  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | sed '$d')
  
  if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
    echo -e "${GREEN}✓${NC} (HTTP $http_code)"
    return 0
  else
    echo -e "${RED}✗${NC} (HTTP $http_code)"
    echo "Response: $body"
    return 1
  fi
}

# Health check
echo "=== Health Check ==="
test_endpoint "GET" "/health" "" "Health check"
echo ""

# Create Organisation
echo "=== Create Organisation ==="
org_data='{"name":"Test Organisation","billingEmail":"test@example.com"}'
test_endpoint "POST" "/api/v1/admin/organisations" "$org_data" "Create organisation"
echo ""

# Note: In a real test, you would:
# 1. Extract organisation ID from response
# 2. Use it in subsequent tests
# 3. Clean up test data

echo "=== Test Complete ==="
echo ""
echo "Note: This is a basic test. For full testing, see docs/TESTING_GUIDE.md"
