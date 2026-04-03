const express = require("express");
const app = express();
const port = process.env.PORT || 8080;
const message = process.env.CUSTOM_MESSAGE ?? 'Express!'

console.log(`Starting Service: ${process.env.SERVICE_CALLER ?? 'Express'}`);

app.get("/", (req, res) => {
  res.json({ message: `Hello from ${message}` });
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
