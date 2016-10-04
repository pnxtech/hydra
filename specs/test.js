'use strict';

require('./helpers/chai.js');

const config = require('./properties').value;
const version = require('../package.json').version;
const hydra = require('../index.js');

describe('Hydra test', () => {
  it('should ', (done) => {
    hydra.init(config.hydra)
      .then((result) => {
        hydra.getServicePresence('auth-service')
          .then((result) => {
            expect(result).to.be.an.array;
            done();
          });
      });
  });
});

describe('Hydra message queuing', () => {
  it('should queue a message', (done) => {
    hydra.init(config.hydra)
      .then((result) => {
        let message = hydra.createUMFMessage({
          to: 'hydra-test',
          from: 'jasmine-tests:/',
          body: {
            param1: 'value1',
            param2: 'value2'
          }
        });
        hydra.queueMessage(message)
          .then((result) => {
            console.log('result', result);
            done();
          });
      });
  });

  it('should get queued message', (done) => {
    hydra.init(config.hydra)
      .then((result) => {
        hydra.getQueuedMessage('hydra-test')
          .then((result) => {
            console.log('result', result);
            expect(result).to.be.an.array;
            done();
          });
      });
  });
});
