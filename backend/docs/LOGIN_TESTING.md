# Login Testing Guide

This guide explains how to test and troubleshoot authentication issues in the Aruba Central Automation Platform backend.

## Quick Test

```bash
# Show available users and usage
npm run test:login

# Test login with specific credentials
npm run test:login user@example.com password123
```

## What the Login Test Validates

The test script verifies all 6 critical authentication components:

1. **Database Connectivity** - Ensures Prisma can connect to PostgreSQL
2. **User Lookup** - Verifies user exists in database by email
3. **Password Hash Verification** - Tests bcrypt password comparison
4. **JWT Token Generation** - Validates access and refresh token creation
5. **Token Verification** - Confirms generated tokens can be decoded
6. **Complete Login Flow** - Simulates the full authentication process

## Interpreting Results

### ✓ All Tests Pass

Backend authentication is working correctly. If frontend login still fails, the issue is in the frontend code (see Frontend Integration Testing section below).

### ✗ User Not Found

**Possible causes**:
- User doesn't exist in database
- Email address doesn't match (check for typos or case sensitivity)

**Solutions**:
- Run `npm run user:manage` to create/verify users
- Check the list of available users shown by the test script

### ✗ Password Verification Failed

**Possible causes**:
- Incorrect password
- Password wasn't hashed correctly when created

**Solutions**:
- Verify you're using the correct password
- Run `npm run user:manage` to reset the password
- When changing passwords, ensure the user-manager script completes successfully

### ✗ JWT Token Errors

**Possible causes**:
- Missing or invalid JWT secrets in environment

**Solutions**:
- Check `.env` file has `JWT_SECRET` and `JWT_REFRESH_SECRET` configured
- Ensure secrets are non-empty strings
- Copy from `.env.example` if needed

## Testing the Live API

After backend validation passes, test the actual API endpoint:

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}'
```

### Successful Response Format

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "clx1234567890",
      "email": "user@example.com",
      "name": "User Name",
      "role": "admin"
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

### Error Response Format

```json
{
  "success": false,
  "error": "Invalid credentials"
}
```

## Frontend Integration Testing

If backend tests pass but frontend login fails, follow these debugging steps:

### 1. Check API Configuration

Verify the frontend is pointing to the correct backend URL:

```javascript
// Should be configured in frontend
const API_BASE_URL = 'http://localhost:3000/api/v1'
```

Ensure requests include the correct headers:
```javascript
{
  'Content-Type': 'application/json'
}
```

### 2. Verify Request Format

The backend expects this exact format:

```javascript
{
  "email": "user@example.com",
  "password": "password123"
}
```

Common mistakes:
- Using `username` instead of `email`
- Sending password in wrong field
- Missing JSON.stringify() on request body

### 3. Check Browser Developer Tools

Open browser console and check:

**Network Tab**:
- Request URL matches `http://localhost:3000/api/v1/auth/login`
- Request method is POST
- Request payload contains email and password
- Response status code (200 = success, 401 = invalid credentials, 500 = server error)

**Console Tab**:
- Look for CORS errors (red text about "Access-Control-Allow-Origin")
- Check for JavaScript errors in login code
- Look for axios/fetch errors

### 4. Email Normalization

The backend uses `normalizeEmail()` which:
- Converts email to lowercase
- Removes dots from Gmail addresses (optional)
- Normalizes special characters

**Example**:
- Input: `User@Example.COM`
- Normalized: `user@example.com`

Ensure your frontend sends emails in a consistent format, or let the backend handle normalization.

### 5. CORS Configuration

Check backend `.env` file:

```env
FRONTEND_URL=http://localhost:5173
```

This should match your frontend's actual URL. Common ports:
- Vite/Vue: `http://localhost:5173`
- Create React App: `http://localhost:3000`
- Angular: `http://localhost:4200`

If CORS errors persist, verify the backend is running and check `src/config/cors.js` or Express CORS middleware configuration.

### 6. Response Handling

Ensure frontend properly handles the response:

```javascript
// Example axios request
try {
  const response = await axios.post('/auth/login', {
    email: 'user@example.com',
    password: 'password123'
  });

  // Backend returns data in response.data.data
  const { user, accessToken, refreshToken } = response.data.data;

  // Store tokens
  localStorage.setItem('accessToken', accessToken);
  localStorage.setItem('refreshToken', refreshToken);

  // Store user info
  // ... update app state with user

} catch (error) {
  console.error('Login failed:', error.response?.data?.error || error.message);
}
```

### 7. Common Frontend Issues Checklist

- [ ] API base URL configured correctly
- [ ] Content-Type header set to 'application/json'
- [ ] Request body format matches backend expectation
- [ ] CORS configured for frontend URL
- [ ] Backend server is running on expected port
- [ ] Email field (not username) being sent
- [ ] Response handler expects correct structure (response.data.data)
- [ ] Tokens being stored correctly
- [ ] No axios/fetch interceptors interfering with request

## Debugging Flow

```
1. Run: npm run test:login user@example.com password
   ├─ FAILS → Backend issue (database, password, JWT)
   └─ PASSES → Continue to step 2

2. Test curl command (provided by test script)
   ├─ FAILS → Server not running or configuration issue
   └─ PASSES → Continue to step 3

3. Test from frontend UI
   ├─ FAILS → Frontend integration issue (see checklist above)
   └─ PASSES → Login working correctly!
```

## Related Commands

- `npm run user:manage` - Create/update/delete users
- `npm run dev` - Start development server with logging
- `npm run db:migrate` - Run database migrations
- `npm run db:seed` - Seed database with test data

## Need Help?

If you've followed all steps and login still fails:

1. Check backend logs (console output when running `npm run dev`)
2. Enable verbose logging by setting `LOG_LEVEL=debug` in `.env`
3. Review the authentication flow in `src/routes/auth.routes.js`
4. Check middleware configuration in `src/middleware/auth.middleware.js`
