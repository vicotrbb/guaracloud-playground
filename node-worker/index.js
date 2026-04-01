console.log("Worker started");

setInterval(() => {
  console.log(`[${new Date().toISOString()}] Worker is running...`);
}, 5000);
