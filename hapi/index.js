const Hapi = require("@hapi/hapi");

const init = async () => {
  const server = Hapi.server({
    port: process.env.PORT || 8080,
    host: "0.0.0.0",
  });

  server.route({
    method: "GET",
    path: "/",
    handler: () => {
      return { message: "Hello from Hapi!" };
    },
  });

  await server.start();
  console.log(`Server listening on port ${server.info.port}`);
};

init();
