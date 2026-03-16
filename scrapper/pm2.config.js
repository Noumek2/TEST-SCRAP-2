/**
 * pm2.config.js
 * Keeps the scheduler running 24/7 even if the terminal closes.
 *
 * Setup:
 *   npm install -g pm2
 *   pm2 start pm2.config.js
 *   pm2 save             <- saves so it auto-restarts on reboot
 *   pm2 startup          <- follow the printed instructions
 *
 * Useful commands:
 *   pm2 status           <- see if it's running
 *   pm2 logs scraper     <- see live logs
 *   pm2 stop scraper     <- stop it
 *   pm2 restart scraper  <- restart it
 */

module.exports = {
  apps: [
    {
      name:        "scraper",
      script:      "scheduler.js",
      args:        "--time 08:00 --limit 50",  // Change time and limit here
      watch:       false,
      autorestart: true,
      max_restarts: 5,
      env: {
        NODE_ENV: "production",
      },
      log_file:    "./logs/pm2.log",
      error_file:  "./logs/pm2-error.log",
      out_file:    "./logs/pm2-out.log",
      time:        true,
    },
  ],
};
