/* eslint no-invalid-this: 0 */

require('./helpers/chai.js');

let hydra;
const version = require('../package.json').version;
const redis = require('redis-mock');
const redisPort = 6379;
const redisUrl = '127.0.0.1';
const SECOND = 1000;

/**
* @name getConfig
* @summary Get a new copy of a config object
* @return {undefined}
*/
function getConfig() {
  return Object.assign({}, {
    'hydra': {
      'serviceName': 'test-service',
      'serviceDescription': 'Raison d\'etre',
      'serviceIP': '127.0.0.1',
      'servicePort': 5000,
      'serviceType': 'test',
      'redis': {
        'url': redisUrl,
        'port': redisPort,
        'db': 0
      }
    },
    version
  });
}

/**
* Change into specs folder so that config loading can find file using relative path.
*/
process.chdir('./specs');

/**
* @name Tests
* @summary Hydra Test Suite
*/
describe('Hydra', function() {
  this.timeout(SECOND * 10);

  beforeEach(() => {
    hydra = require('../index.js');
    redis.removeAllListeners('message');
  });

  afterEach((done) => {
    hydra.shutdown().then(() => {
      let name = require.resolve('../index.js');
      delete require.cache[name];
      done();
    });
  });

  /**
  * @description Confirms that hydra can connect to a redis instance
  */
  it('should be able to connect to redis', (done) => {
    hydra.init(getConfig(), true)
      .then(() => {
        done();
      })
      .catch((_err) => {
        expect(true);
      });
  });

  /**
  * @description Hydra should fail to load without a configuration file
  */
  it('should fail without config file', (done) => {
    hydra.init({}, true)
      .then(() => {
        expect(true).to.be.false;
        done();
      })
      .catch((err) => {
        expect(err).to.not.be.null;
        expect(err.message).to.equal('Config missing serviceName or servicePort');
        done();
      });
  });

  /**
  * @description Hydra should load if serviceName and servicePort is provided
  */
  it('should load if serviceName and servicePort is provided', (done) => {
    hydra.init({
      hydra: {
        serviceName: 'test-service',
        servicePort: 3000
      }
    }, true)
      .then(() => {
        done();
      })
      .catch((err) => {
        expect(err).to.be.null;
        done();
      });
  });

  /**
  * @description Hydra should load without a hydra.redis branch in configuration
  */
  it('should load without config hydra.redis branch', (done) => {
    let config = getConfig();
    delete config.hydra.redis;
    hydra.init(config, true)
      .then(() => {
        done();
      })
      .catch((err) => {
        expect(err).to.be.null;
        done();
      });
  });

  /**
  * @description Hydra should fail if serviceName is missing in config
  */
  it('should fail without serviceName config', (done) => {
    let config = getConfig();
    delete config.hydra.serviceName;
    hydra.init(config, true)
      .then(() => {
        expect(true).to.be.false;
        done();
      })
      .catch((err) => {
        expect(err).to.not.be.null;
        expect(err.message).to.equal('Config missing serviceName or servicePort');
        done();
      });
  });

  /**
  * @description Confirms that when hydra registers as a service the expected keys can be found in redis
  */
  it('should be able to register as a service', (done) => {
    hydra.init(getConfig(), true)
      .then(() => {
        let r = redis.createClient();
        hydra.registerService()
          .then((_serviceInfo) => {
            setTimeout(() => {
              r.keys('*', (err, data) => {
                expect(err).to.be.null;
                expect(data.length).to.equal(3);
                expect(data).to.include('hydra:service:test-service:service');
                expect(data).to.include('hydra:service:nodes');
                done();
              });
              r.quit();
            }, SECOND);
          });
      });
  });

  /**
  * @description expect serviceName, serviceIP, servicePort and instanceID to exists upon service registration
  */
  it('should have a serviceName, serviceIP, servicePort and instanceID', (done) => {
    hydra.init(getConfig(), true)
      .then(() => {
        hydra.registerService()
          .then((serviceInfo) => {
            expect(serviceInfo).not.null;
            expect(serviceInfo.serviceName).to.equal('test-service');
            expect(serviceInfo.serviceIP).to.equal('127.0.0.1');
            expect(serviceInfo.servicePort).to.equal('5000');
            done();
          });
      });
  });

  /**
  * @description getServiceName should return name of service
  */
  it('should see that getServiceName returns name of service', (done) => {
    hydra.init(getConfig(), true)
      .then(() => {
        hydra.registerService()
          .then((serviceInfo) => {
            expect(serviceInfo).not.null;
            expect(serviceInfo.serviceName).to.equal('test-service');
            expect(hydra.getServiceName()).to.equal(serviceInfo.serviceName);
            done();
          });
      });
  });

  /**
  /**
  * @description getServices should return a list of services
  */
  it('should see that getServices returns list services', (done) => {
    hydra.init(getConfig(), true)
      .then(() => {
        hydra.registerService()
          .then((_serviceInfo) => {
            hydra.getServices()
              .then((services) => {
                expect(services.length).to.be.above(0);
                expect(services[0]).to.have.property('serviceName');
                expect(services[0]).to.have.property('type');
                expect(services[0]).to.have.property('registeredOn');
                done();
              });
          });
      });
  });

  /* @description getServiceNodes should return a list of services
  */
  it('should see that getServiceNodes returns list services', (done) => {
    hydra.init(getConfig(), true)
      .then(() => {
        hydra.registerService()
          .then((_serviceInfo) => {
            hydra.getServiceNodes()
              .then((nodes) => {
                expect(nodes.length).to.be.above(0);
                expect(nodes[0]).to.have.property('serviceName');
                expect(nodes[0]).to.have.property('instanceID');
                expect(nodes[0]).to.have.property('processID');
                expect(nodes[0]).to.have.property('ip');
                done();
              });
          });
      });
  });

  /**
  * @description getServiceName should return name of service
  */
  it('should see that getServiceName returns name of service', (done) => {
    hydra.init(getConfig(), true)
      .then(() => {
        hydra.registerService()
          .then((serviceInfo) => {
            expect(serviceInfo).not.null;
            expect(serviceInfo.serviceName).to.equal('test-service');
            expect(hydra.getServiceName()).to.equal(serviceInfo.serviceName);
            done();
          });
      });
  });

  /**
  /**
  * @description getServices should return a list of services
  */
  it('should see that getServices returns list services', (done) => {
    hydra.init(getConfig(), true)
      .then(() => {
        hydra.registerService()
          .then((_serviceInfo) => {
            hydra.getServices()
              .then((services) => {
                expect(services.length).to.be.above(0);
                expect(services[0]).to.have.property('serviceName');
                expect(services[0]).to.have.property('type');
                expect(services[0]).to.have.property('registeredOn');
                done();
              });
          });
      });
  });

  /* @description getServiceNodes should return a list of services
  */
  it('should see that getServiceNodes returns list services', (done) => {
    hydra.init(getConfig(), true)
      .then(() => {
        hydra.registerService()
          .then((_serviceInfo) => {
            hydra.getServiceNodes()
              .then((nodes) => {
                expect(nodes.length).to.be.above(0);
                expect(nodes[0]).to.have.property('serviceName');
                expect(nodes[0]).to.have.property('instanceID');
                expect(nodes[0]).to.have.property('processID');
                expect(nodes[0]).to.have.property('ip');
                done();
              });
          });
      });
  });

  /**
  * @description presence information should update in redis for a running hydra service
  */
  it('should update presence', (done) => {
    hydra.init(getConfig(), true)
      .then(() => {
        let r = redis.createClient();
        hydra.registerService()
          .then((_serviceInfo) => {
            let instanceID = hydra.getInstanceID();
            r.hget('hydra:service:nodes', instanceID, (err, data) => {
              expect(err).to.be.null;
              expect(data).to.not.be.null;

              let entry = JSON.parse(data);
              setTimeout(() => {
                r.hget('hydra:service:nodes', instanceID, (err, data) => {
                  expect(err).to.be.null;
                  expect(data).to.not.be.null;
                  let entry2 = JSON.parse(data);
                  expect(entry2.updatedOn).to.not.equal(entry.updatedOn);
                  r.quit();
                  done();
                });
              }, SECOND);
            });
          });
      });
  });

  /**
  * @description ensure keys expire on shutdown
  */
  it('should expire redis keys on shutdown', (done) => {
    hydra.init(getConfig(), true)
      .then(() => {
        let r = redis.createClient();
        hydra.registerService()
          .then((_serviceInfo) => {
            setTimeout(() => {
              r.get('hydra:service:test-service:73909f8c96a9d08e876411c0a212a1f4:presence', (err, _data) => {
                expect(err).to.be.null;
                done();
                r.quit();
              });
            }, SECOND * 5);
          });
      });
  });

  /**
  * @summary service should be discoverable
  */
  it('should be able to discover a service', (done) => {
    hydra.init(getConfig(), true)
      .then(() => {
        hydra.registerService()
          .then((_serviceInfo) => {
            setTimeout(() => {
              hydra.findService('test-service')
                .then((data) => {
                  expect(data).not.null;
                  expect(data.serviceName).to.equal('test-service');
                  expect(data.type).to.equal('test');
                  done();
                });
            }, SECOND);
          });
      });
  });

  /**
  * @summary invalid service should not be discoverable
  */
  it('should return an error if a service doesn\'t exists', (done) => {
    hydra.init(getConfig(), true)
      .then(() => {
        hydra.registerService()
          .then((_serviceInfo) => {
            setTimeout(() => {
              hydra.findService('xyxyx-service')
                .then((_data) => {
                  expect(true).to.be.false;
                  done();
                })
                .catch((err) => {
                  expect(err).to.not.be.null;
                  expect(err.message).to.equal('Can\'t find xyxyx-service service');
                  done();
                });
            }, SECOND);
          });
      });
  });

  /**
  * @summary get service presence info
  */
  it('should be able to retrieve service presence', (done) => {
    hydra.init(getConfig(), true)
      .then(() => {
        hydra.registerService()
          .then((_serviceInfo) => {
            hydra.getServicePresence('test-service')
              .then((data) => {
                expect(data).to.not.be.null;
                expect(data.length).to.be.above(0);
                expect(data[0]).to.have.property('processID');
                expect(data[0].updatedOnTS).to.be.above(1492906823975);
                done();
              });
          });
      });
  });
});
