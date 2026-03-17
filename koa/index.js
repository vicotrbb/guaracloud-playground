const Koa = require("koa");
const app = new Koa();
const port = process.env.PORT || 8080;

app.use((ctx) => {
  ctx.body = { message: "Hello from Koa!" };
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
