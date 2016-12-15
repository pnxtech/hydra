# Hydra plugins

## Quick Tutorial

Set up a hydra service:
```
$ yo fwsp-hydra
? Name of the service (`-service` will be appended automatically) pingpong
? Host the service runs on?
? Port the service runs on? 0
? What does this service do? demo
? Does this service need auth? No
? Is this a hydra-express service? No
? Set up logging? No
? Run npm install? Yes
```

In pong-plugin.js:
```javascript
// whenever a 'ping' event is emitted, a 'pong' event is emitted after a user-defined delay
const Promise = require('bluebird');
const HydraPlugin = require('fwsp-hydra/plugin');
class PongPlugin extends HydraPlugin {
  constructor() {
    super('example'); // unique identifier for the plugin
  }
  // called at the beginning of hydra.init
  // the parent class will locate the plugin config and set this.opts
  // can return a Promise or a value
  // in this case, there's no return statement, so that value is undefined
  setConfig(hydraConfig) {
    super.setConfig(hydraConfig);
    this.configChanged(this.opts);
    this.hydra.on('ping', () => {
      Promise.delay(this.opts.pongDelay).then(() => {
        this.hydra.emit('pong');
      });
    })
  }
  // called when the config for this plugin has changed (via HydraEvent.CONFIG_UPDATE_EVENT)
  // if you need access to the full service config, override updateConfig(serviceConfig)
  configChanged(opts) {
    if (this.opts.pongDelay === "random") {
      this.opts.pongDelay = Math.floor(Math.random() * 3000);
      console.log(`Random delay = ${this.opts.pongDelay}`);
    }
  }
  // called after hydra has initialized but before hydra.init Promise resolves
  // can return a Promise or a value
  // this will delay by the port number in ms for demonstration of Promise
  onServiceReady() {
    console.log(`[example plugin] hydra service running on ${this.hydra.config.servicePort}`);
    console.log('[example plugin] delaying serviceReady...');
    return new Promise((resolve, reject) => {
      Promise.delay(this.hydra.config.servicePort)
        .then(() => {
          console.log('[example plugin] delayed serviceReady, pinging...');
          this.hydra.emit('ping');
          resolve();
        });
      });
  }
}
module.exports = PongPlugin;
```

Add to config.json:
```json
{
  "hydra": {
    "plugins": {
      "example": {
        "pongDelay": 2000
      }
    }
  }
}
```

In your hydra service:
```javascript
const version = require('./package.json').version;
const hydra = require('fwsp-hydra');

// install plugin
const PongPlugin = require('./pong-plugin.js');
hydra.use(new PongPlugin());

// add some console.logs so we can see the events happen
hydra.on('ping', () => console.log('PING!'));
hydra.on('pong', () => {
  console.log('PONG!');
  // send a ping back, after a random delay of up to 2s, to keep the rally going
  setTimeout(() => hydra.emit('ping'), Math.floor(Math.random() * 2000));
});


let config = require('fwsp-config');
config.init('./config/config.json')
  .then(() => {
    config.version = version;
      config.hydra.serviceVersion = version;
      hydra.init(config.hydra)
        .then(() => hydra.registerService())
        .then(serviceInfo => {

          console.log(serviceInfo); // so we see when the serviceInfo resolves

          let logEntry = `Starting ${config.hydra.serviceName} (v.${config.version})`;
          hydra.sendToHealthLog('info', logEntry);
        })
        .catch(err => {
          console.log('Error initializing hydra', err);
        });
  });
```

Run `npm start`.  After an initial delay, you should start seeing PING!s and PONG!s.
