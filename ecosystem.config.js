module.exports = {
  apps: [
    {
      name: 'crickethub',
      script: 'server.js',
      instances: 1, // Single instance for in-memory rooms sync (or use Redis adapter for multi-instance)
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    }
  ]
};
