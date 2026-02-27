const env = require('../src/configuration/env');
const logger = require('../src/configuration/logger');

console.log('✅ Validation des variables d\'environnement:');
console.log('----------------------------------------');
console.log(`Environnement: ${env.NODE_ENV}`);
console.log(`Serveur: ${env.HOST}:${env.PORT}`);
console.log(`Base de données: ${env.DB_NAME}@${env.DB_HOST}`);
console.log(`Redis: ${env.REDIS_URL}`);
console.log(`Stockage: ${env.STORAGE_DRIVER}`);
console.log(`Log level: ${env.LOG_LEVEL}`);
console.log('----------------------------------------');

if (env.NODE_ENV === 'production') {
  // Vérifications supplémentaires en production
  const checks = [
    { name: 'JWT_SECRET', condition: env.JWT_SECRET.length >= 32 },
    { name: 'JWT_REFRESH_SECRET', condition: env.JWT_REFRESH_SECRET.length >= 32 },
    { name: 'DB_SSL', condition: env.DB_SSL === true },
    { name: 'REDIS_PASSWORD', condition: env.REDIS_PASSWORD && env.REDIS_PASSWORD.length > 0 },
    { name: 'LOG_FILE', condition: !!env.LOG_FILE }
  ];
  
  console.log('\n🔒 Vérifications production:');
  checks.forEach(check => {
    console.log(`  ${check.condition ? '✅' : '❌'} ${check.name}`);
  });
}