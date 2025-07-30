const Fastify = require('fastify');
const websocket = require('@fastify/websocket');
const formBody = require('@fastify/formbody');
const config = require('./config');
const { setup } = require('./setup');

if (config.setupdone === 'false') setup();

const fastify = Fastify({ logger: true });
fastify.register(websocket);
fastify.register(formBody);

fastify.register(require('./routes/inbound'));
fastify.register(require('./routes/outbound'));
fastify.register(require('./routes/status'));

const PORT = config.server.port || 1337;
fastify.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  fastify.log.info(`🚀 Server listening at ${address}`);
});