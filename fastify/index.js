const fastify = require("fastify")({ logger: true });
const port = process.env.PORT || 8080;

fastify.get("/", async () => {
  return { message: "Hello from Fastify!" };
});

fastify.listen({ port: Number(port), host: "0.0.0.0" }).then(() => {
  console.log(`Server listening on port ${port}`);
});
