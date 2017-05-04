# Hydra plugins

Hydra's behavior and features can be extended through plugins, allowing different Hydra services or plugins to easily take advantage of shared functionalities.

## Overview

Hydra plugins extend the HydraPlugin class.

Plugins should be registered before Hydra is initialized via hydra.init.

E.g.

```js
const YourPlugin = require('./your-plugin');
hydra.use(new YourPlugin());
```

Hydra will automatically call several hooks defined by the plugin class:

| Hook | Description
| --- | ---
| `setHydra(hydra)` | called during plugin registration
| `setConfig(config)` | called before hydra initialization
| `updateConfig(serviceConfig)` | when the service-level config changes, will call configChanged if this plugin's options have changed
| `configChanged(options)` | when the plugin-level options change
| `onServiceReady()` | when the service has initialized but before the hydra.init Promise resolves

### Hook return values

`setHydra`, `setConfig`, and `onServiceReady` can return a value or a Promise.

The actual return value isn't important; if the hook returns a value, success is assumed.
If an error in plugin initialization should result in the service failing to start,
the plugin hook should throw an Error.

Similarly if a Promise is returned and resolves, success is assumed; the resolve() value is ignored.
Fatal errors should reject().

## Quick Tutorial

Set up a plugin in five easy steps.

### 1. Set up a hydra service:

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

$ cd pingpong-service
```

### 2. Create pong-plugin.js:

***Tip:** On OS X, you can copy this snippet and then `pbpaste > pong-plugin.js`*

```js
// whenever a 'ping' event is emitted, a 'pong' event is emitted after a user-defined delay
const Promise = require('bluebird');
const HydraPlugin = require('hydra/plugin');

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

### 3. Update `hydra` section of `config.json` to pass the plugin configuration:

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

### 4. Set up hydra service entry-point script:
```js
const version = require('./package.json').version;
const hydra = require('fwsp-hydra');

// install plugin
const PongPlugin = require('./pong-plugin');
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

### 5. Try it out!

Run `npm start`.  After an initial delay, you should start seeing PING!s and PONG!s.

### 6. Learn more from others:
You may want to also learn from the implementation of the following hydra plugins as a reference:
* [hydra-plugin-http](https://github.com/jkyberneees/hydra-plugin-http): Hydra plugin that adds traditional HTTP requests, routing and proxy capabilities to your hydra micro-services.
* [hydra-plugin-rpc](https://github.com/ecwyne/hydra-plugin-rpc): Hydra-RPC Plugin for Hydra microservices library https://www.hydramicroservice.com
