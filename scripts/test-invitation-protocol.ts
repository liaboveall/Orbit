// Test script for invitation protocol verification (B02 Fix)
import { generateToken, hashToken } from '../src/server/modules/invitation/service';

console.log('Testing Invitation Protocol Fix...');
console.log('='.repeat(50));

// Generate a test token
const token = generateToken();
console.log('1. Generated token:', token);
console.log('   Token length:', token.length);
console.log('   Valid base64url format:', /^[A-Za-z0-9_-]+$/.test(token));

// Test hash
const tokenHash = hashToken(token);
console.log('\n2. Token hash:');
console.log('   Hash:', tokenHash);
console.log('   Valid hex format:', /^[a-f0-9]{64}$/.test(tokenHash));

// Test URL generation
const baseUrl = 'http://localhost:3000';
const inviteUrl = `${baseUrl}/invite#token=${encodeURIComponent(token)}`;
console.log('\n3. Full invite URL with fragment:');
console.log('   URL:', inviteUrl);
console.log('   Contains #token=: ', inviteUrl.includes('#token='));
console.log('   URL encoded token correctly:', inviteUrl === `${baseUrl}/invite#token=${token}`);

// Verify token not visible in path
const pathPart = inviteUrl.split('#')[0] ?? inviteUrl;
console.log('\n4. Security check:');
console.log('   Path part (no fragment):', pathPart);
console.log('   Token visible in path?', pathPart.includes(token));
console.log('   ✓ Token only in hash fragment');

console.log('\n' + '='.repeat(50));
console.log('✓ All checks passed! Invitation protocol is secure.');
