// test-token.js
const env = require('../../../src/configuration/env');
const TokenService = require('../../../src/services/security/TokenService');

console.log('🔍 Test de configuration JWT');
console.log('============================');
console.log('NODE_ENV:', env.NODE_ENV);
console.log('JWT_SECRET présent:', !!env.JWT_SECRET);
console.log('JWT_REFRESH_SECRET présent:', !!env.JWT_REFRESH_SECRET);
console.log('JWT_EXPIRES_IN:', env.JWT_EXPIRES_IN);
console.log('JWT_REFRESH_EXPIRES_IN:', env.JWT_REFRESH_EXPIRES_IN);

console.log('\n🔐 Test génération token...');
try {
  const payload = { id: 1, email: 'test@test.com', role: 'user' };
  const accessToken = TokenService.generateAccessToken(payload);
  console.log('✅ Access token généré:', accessToken.substring(0, 30) + '...');
  
  const verified = TokenService.verifyAccessToken(accessToken);
  console.log('✅ Token vérifié:', verified);
  
} catch (error) {
  console.error('❌ Erreur:', error.message);
}