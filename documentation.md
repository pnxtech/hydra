![](hydra.png)

Hydra is a module designed to enable the construction of microservices and/or enable non-service applications to discover and utilize microservices. As such, Hydra helps address a broad class of concerns when building distributed applications.

> ☕ This project was named after [Hydra](https://en.wikipedia.org/wiki/Hydra_(Dungeons_%26_Dragons)), a mythical multi-headed beast from Greek and Roman mythology.
> Each head capable of acting independently while achieving an objective. That plays nicely with the idea of multiple processes working to provide a service.

While Hydra is implemented for NodeJS, the functionality it enables can be implemented for other platforms. ***The core service dependency is on a shared Redis instance or cluster such as Amazon's ElasticCache***.  To learn more about Redis see [Redis.io](http://redis.io)

As a Node module, Hydra provides drop-in functionality which is designed to address the following microservice concerns:

* **Service Registration**: allowing services to register themselves when they come online and to publish their HTTP API routes.
* **API Routability**: allows API calls to be routed to a microservice.
* **Messaging Communication**: Inter-service communication via publish and subscribe channels and Message Queues.
* **Service Load Balancing**: automatically load balances requests based on available (present) instances of a microservice.
* **Service Discovery**: locating services without having to hardcode their IP addresses and Port information.
* **Health Reporting**: Automatic health check reporting, to answer questions such as: Is the application healthy? Is it functioning properly?
* **Presence Reporting**: Is an instance of service actually available?

> ☕ If you're using ExpressJS to build your microservice you should consider using the [Hydra-Express](https://github.com/flywheelsports/hydra-express) module which provides ExpressJS bindings and a higher level of abstraction.

In this document we'll refer to `services` and `service instances`. A Service Instance and Service Node refers to the same thing. A service is simply the name given to one or more service instances, consider it a class of service. For example, we might have a service to handle image resizing, and we might simply call that service `image-resizer`. In our cloud infrastructure we might have three instances of the image-resizer service running in response to high demand.  Each instance is a service instance or node.

In Hydra, a service instance is simply a process which uses Hydra to handle microservice concerns.

> ☕ For a quick overview of what Hydra offers refer to the end of this document for a list of public methods.

* [Installing Hydra](#installing-hydra)
* [Using Hydra](#using-hydra)
   * [Importing Hydra](#importing-hydra)
   * [Initialization](#initialization)
       * [Redis Configuration](#redis-configuration)
   * [Hydra modes](#hydra-modes)
       * [Service mode](#service-mode)
       * [Consumer mode](#consumer-mode)
   * [Service Discovery](#service-discovery)
   * [Presence](#presence)
   * [Health and Presence](#health-and-presence)
   * [Using Hydra to monitor services](#using-hydra-to-monitor-services)
   * [Messaging](#messaging)
      * [Inter-service messaging](#inter-service-messaging)
         * [Built-in message channels](#built-in-message-channels)
      * [UMF messaging](#umf-messaging)
 * [Hydra Methods](#hydra-methods)
 * [Hydra Plugins](#hydra-plugins)


# Installing Hydra

To use Hydra from another project:

```
$ npm install hydra
```

# Using Hydra

## Importing Hydra

To load Hydra simply import it:

```javascript
const hydra = require('hydra');
```

## Initialization

On import, the Hydra module is loaded but must first be initialized before it can be used.

```javascript
hydra.init(initObject);
```

The initialization object consist of the following fields:

```javascript
{
  serviceName: 'hydramcp',
  serviceDescription: 'Hydra Master Control Program',
  serviceIP: '',
  servicePort: 0,
  serviceType: 'mcp',
  redis: {
    host: '127.0.0.1',
    port: 6379,
    db: 0
  }
}
```

All of the fields shown are required.  However, if your application isn't going to function as a service then the following values can be blank and will be ignored. It's considered a best practice to blank the values if you don't intend for them to be used:

```javascript
serviceName: '',
serviceDescription: '',
serviceIP: '',
servicePort: 0,
serviceType: '',
```

> **Important**: When Hydra is being used in a service, if serviceIP is equal to an empty string (''), then the machine's local IP will be used, otherwise a four segment IP address is expected (52.9.201.160). If servicePort is equal to zero then Hydra will choose a random port. Set `servicePort` in cases where you need a microservice to use a specific port address.

> **Important**: The `hydra.redis.db` value must be set to the same value for all network services in a cluster. Not doing this will impact service discoverability and monitoring. The reason a redis database value isn't hardcoded within Hydra is because the number of databases present on a Redis instance isn't guaranteed to be the same across providers. So ultimately the service implementor (you?) needs the flexibility of setting this value and thus bare the responsibility.

In an actual production system the Hydra JSON might be embedded in a larger configuration file such as a properties.js file:

```javascript
exports.value = {
  appServiceName: 'hydramcp',
  cluster: false,
  environment: 'development',
  maxSockets: 500,
  logPath: '',
  hydra: {
    serviceName: 'hydramcp',
    serviceDescription: 'Hydra Master Control Program',
    serviceVersion: '1.0.0',
    serviceIP: '',
    servicePort: 0,
    serviceType: 'mcp',
    serviceWorker: false,
    redis: {
      host: '127.0.0.1',
      port: 6379,
      db: 0
    }
  }
};
```

When using this approach simply pass the hydra branch during initialization:

```javascript
hydra.init(config.hydra);
```

### Redis Configuration

In addition to `host`, `port`, and `db`, you can pass any options supported by the [node redis client](https://github.com/NodeRedis/node_redis) `createClient` method.

The exception to this is `retry_strategy`, which takes a function argument in `redis.createClient`. Hydra provides a retry_strategy (`hydra._redisRetryStrategy`), which is configured via the `hydra.redis.retry_strategy` option rather than being passed directly to `redis.createClient`:

```javascript
  redis: {
    host: "127.0.0.1",
    port: 6379,
    db: 15,
    retry_strategy: {
      maxReconnectionPeriod: 15,
      maxDelayBetweenReconnections: 5
    }
  }
```

If you want to implement your own retry strategy, extend Hydra and override the `_redisRetryStrategy` method.

You also have the option of using the `url` parameter instead of `host`, `port`, `db`, and `password`. See the [IANA registration](http://www.iana.org/assignments/uri-schemes/prov/redis) for details. The following is equivalent to the above host/port/db:

```javascript
redis: {
  url: 'redis://127.0.0.1:6379/15'
}
```

Note: If you pass in *both* a `url` and some combination of `host`, `port`, `db`, and `password`, the values in `url` will be overridden by the more specific entries:

```javascript
redis: {
  url: 'redis://127.0.0.1:6379/15',
  db: 10
}
```

This will connect to database `10` instead of database `15`.

## Hydra modes

Hydra may be configured for use in one of two modes:

1. ***Service mode*** - acts as a service and consumer of other services.
2. ***Consumer mode*** - only acts as a service consumer without itself being a service.

#### Service mode

To use Hydra in the `Service mode` you must first register it using:

```javascript
hydra.registerService();
```

> Note: if your application doesn't need to be a service then you don't need to perform this registration.

After a service is registered, hydra emits NodeJS events when log events are generated or messages arrive. You can listen for those events as follows:

```javascript
hydra.registerService();
hydra.on('log', function(entry) {});
hydra.on('message', function(message) {});
```

#### Consumer mode

If a consumer mode application calls a service mode related method an exception or failed promise will result. Each call is clearly documented at the end of this document to help avoid misuse. But as always make sure your application is adequately tested.

## Service Discovery

Both Service and Consumer mode applications can discover other services. But keep in mind that Consumer mode applications can't themselves be discoverable.  Only registered services can be discoverable.

Services are discovered using the `findService()` method. The findService() method accepts a service name and returns a promise which will resolve to a service information object or a rejected promise if the service can't be found.

```javascript
hydra.findService('imageprocessor')
  .then((service) => {
    console.log(service);
  })
  .catch((err) => {
    console.log('catch err', err);
  });
```

The service object returned might look like this:

```javascript
{
  "serviceName": "imageprocessor",
  "processID": 25246,
  "registeredOn": "2016-03-26T18:26:31.334Z",
  "ip": "10.0.0.4",
  "port": 9001,
  "type": "image:processing"
}
```

An application can then use the `ip` and `port` information to call APIs on the imageprocessor service.  

## Presence

Just because a service can be located doesn't mean it's currently online and active.  In an unfortunate case, the service in question might be failing and/or temporarily unavailable.

Hydra offers the `getServicePresence()` method to determine whether a service is currently available. If available an object like this is returned:

```
{
  "updatedOn": "2016-03-28T01:43:45.756Z"
}
```

If unavailable then `getServicePresence()` returns a rejected promise.

## Health and Presence

When Hydra is configured in service mode it automatically records machine and application level information in the designated Redis server.  In addition, Hydra sends presence information. In the unfortunate event that the host application crashes then Hydra would naturally stop updating presence information.

Additionally, Hydra maintains an internal log where it stores issues it detects. We can think of this as a black box flight recorder.

While all of this happens automatically, your application can augment the information stored by using Hydra's `sendToHealthLog()` method.  You can also retrieve the log using the `getServiceHealthLog()` method.

Remember you can also directly receive these log entries as they occur by registering a log event listener during service registration.

## Using Hydra to monitor services

The HydraMCP web application demonstrates how Hydra services can be monitored. There are two methods of monitoring:

* Read the data hydra services write to Redis
* Use Hydra methods to receive aggregate service data.

The latter method is recommended as it is expected to be more resilient to future underlying changes to how Hydra stores data in Redis.

The follow methods facilitate service introspection and control.

Method | Description
--- | ---
getServices | Retrieves a list of registered services.
findService | Locates a specific service.
getServicePresence | Retrieves the presence status of a particular service
getServiceHealthAll | Retrieves the health information and health logs for all registered services.
makeAPIRequest | Makes an API request to the named service.

> Refer to the end of this document for a complete listing of Hydra functions.

## Messaging

Hydra supports inter-service communication in the following ways:

* Discovery and direct use of the server's networking info (IP and Port).
* Through the use of the `makeAPIRequest` method.
* Using inter-service messaging.
* Using service message queues.

Which approach you use depends on your application's requirements and the amount of extra work you're willing to do. Using Hydra's messaging methods abstracts the network layer functionality you might otherwise need to contend with. So it offers an easier and more reliable way of interacting with remote services.

Discovery and direct use of the service's networking info is straightforward:

```javascript
let apiRoute = '/v1/email/send';
hydra.findService('emailer')
  .then((service) => {
    let url = `http://${service.ip}:${service.port}/${apiRoute}`;
    let options = {
      headers: {
        'content-type': 'application/json',
        'Accept': 'application/json; charset=UTF-8'
      },
      method: 'post'
    };
    options.body = emailObject;
    fetch(url, options)
    :
    :
```

> Note: using the above approach should be preceded by a check to see whether the service is available using the `getServicePresence` method. After all, we want to make sure the service is both registered, and currently available.

This is where using Hydra's `makeAPIRequest` method ends up being easier and less error prone. The `makeAPIRequest` method accepts an object which contains the service's name along with other useful, but optional, information. The method automatically handles checking for service availability and can even push the message (request) to the service's message queue if the service is temporally unavailable. This is optional behavior and presumes that this is acceptable to the sender and that the remote service is capable of handling the request as a queued message.

```javascript
let message = hydra.createUMFMessage({
  to: 'emailer:/v1/email/send',
  from: 'website:backend',
  body: {
    to: 'user@someplace.com',
    from: 'marketing@company.com',
    emailBody: 'Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium'
    fallbackToQueue: true
  }
});
hydra.makeAPIRequest(message)
  then()
:
```

### Inter-service messaging

Using Hydra you can send messages between services and even route messages among a series of services. This is one of the features that the [Hydra-Router](https://github.com/flywheelsports/hydra-router) offers.

#### Built-in message channels

Every hydra service automatically listens to two built-in channels, where messages sent from other services arrive.

One channel listens to any message sent to a type of service, another channel listens for messages directed to a specific service instance. So a message sent to a `file-processing` service would be received by all instances of that service. While a message sent to `5585f53bd1171db38eafd79bf16e02f4@file-processing` would only be handled by the service instance with an ID of `5585f53bd1171db38eafd79bf16e02f4`.

To send a message to a service you can use the `sendMessage` call.

```javascript
let message = hydra.createUMFMessage({
  to: 'test-service:/',
  from: 'blue-service:/',
  body: {
    fileData: '{base64}'
  }
});
hydra.sendMessage(message);
```

The first parameter is the name of the service you want to send a message to, and the second parameter is a UMF formatted object containing a message.

When sendMessage is used, the message is sent to an available, randomly selected, service instance. If you need to specify a specific instance you can simply address a service using its unique service ID. This is shown in the `to` message field below.


```javascript
let message = hydra.createUMFMessage({
  to: 'cef54f47984626c9efbf070c50bfad1b@test-service:/',
  from: 'blue-service:/',
  body: {
    fileData: '{base64}'
  }
});
hydra.sendMessage(message);
```

You can obtain a service's unique ID via the `getInstanceID()` or  `getServicePresence()` methods.

If you need too, you can use the `sendBroadcastMessage` method to send a message to ALL the available instances of a service.

> Warning: Although, you can use `sendMessage` to send and respond to messages - it's recommended that you use `sendReplyMessage` when replying. The reason for this is that sendReplyMessage uses the source message to properly fill out UMF fields required for robust messaging. This includes things like using the source mid, for, to, from UMF fields to formulate a reply message.

Your service can receive messages by adding a listener to your loaded hydra instance. The example below demonstrates how to also formulate a response if necessary.

```javascript
hydra.registerService();
hydra.on('message', function(message) {
  // message will be a UMF formatted object
  console.log(`Received object message: ${msg.mid}: ${JSON.stringify(msg)}`);

  // to send a reply message here or elsewhere in your service use the `sendReplyMessage` call.
  hydra.sendReplyMessage(message, hydra.createUMFMessage({
    body: {
      // response items
    }
  }));
});
```

### UMF messaging

In the prior example, we used a UMF style message, which is created by the Hydra `createUMFMessage` method.  UMF is an acronym for Universal Message Format and is a light-weight messaging protocol designed for routable and queue-able messaging.

UMF allows you to optionally specify that a message should be sent to one service which in turn should send the message and/or additional results to another service. In this way, processes can be chained across services.

Let's demystify UMF a bit by looking at what the `createUMFMessage` actually does.

First, the method accepts a message object.  In that object three fields are required:

```javascript
{
  "to":'serviceName',
  "from": 'sending-entity-name',
  "body": {}
}
```

The createUMFMessage method takes that object and returns a new one with additional fields:

```javascript
{
  "mid": "02d7e85b-5609-4179-b3af-fee60efc8ef0",
  "timestamp": "2016-03-28T15:40:05.820Z",
  "version": "UMF/1.2",
  "priority": "normal",
  "type": "msg",
  "to": "filewatcher",
  "from": "hydramcp",
  "body": {
    "actions": [
      "restart",
      "processBatch"
    ]
  }
}
```

The additional fields are defined by the UMF specification and aid Hydra, and other distributed systems in the handling of messages.  

The `createUMFMessage` helper method helps ensure that we're starting with a properly formatted UMF compatible message which we can further extend.

For example, here we can change the `priority` and `type` of the message before passing it along to the `makeAPIRequest` method.

```javascript
message.priority = 'high';
message.type = 'service:control';
```

It's important to note that we could have added the `priority` and `type` fields to our original message that was passed to `createUMFMessage`. The method will use your supplied fields to overwrite the ones it creates by default.  So it's important to not overwrite `mid` or `timestamp` in careless ways.

> Note: For a detailed look at the UMF spec, visit: [Universal Messaging Format](https://github.com/cjus/umf)


# Hydra Methods

The following represents Hydra's publicly exported methods.

> ☕ As a module, Hydra is designed to hide and discourage use of its internal methods. This helps to ensure that Hydra behaves as intended across a growing list of services.

The list of methods below are organized by the sections which follow. Not all applications and services require the use of all of the methods listed.

* Setup - Module setup and service registration
* Discovery - Service discovery
* Presence - Presence inspection
* Health - Health check and logging
* Messaging - Message sending
* Routing - Message routing

## Setup

#### init
Initialize Hydra with config object.
```javascript
/**
 * @name init
 * @summary Initialize Hydra with config object.
 * @param {object} config - configuration object containing hydra specific keys/values
 * @return {object} promise - resolving if init success or rejecting otherwise
 */
init(config)
```

#### shutdown
Shutdown hydra safely.
```javascript
/**
* @name _shutdown
* @summary Shutdown hydra safely.
*/
shutdown()
```

#### registerService
Registers this machine as a Hydra instance.
```javascript
/**
 * @name registerService
 * @summary Registers this machine as a Hydra instance.
 * @description This is an optional call as this module might just be used to monitor and query instances.
 * @return {object} promise - resolving if registration success or rejecting otherwise
 */
registerService()
```

## Discovery
#### getServiceName
Retrieves the service name of the current instance.
```javascript
/**
 * @name getServiceName
 * @summary Retrieves the service name of the current instance.
 * @throws Throws an error if this machine isn't a instance.
 * @return {string} serviceName - returns the service name.
 */
getServiceName()
```

#### getServices
Retrieve a list of available instance services.
```javascript
/**
 * @name getServices
 * @summary Retrieve a list of available instance services.
 * @return {promise} promise - returns a promise which resolves to an array of objects.
 */
getServices()
```

#### findService
Finds a service.
```javascript
/**
 * @name findService
 * @summary Find a service.
 * @param {string} name - service name - note service name is case insensitive
 * @return {promise} promise - which resolves with service
 */
findService(name)
```

## Presence
#### getServicePresence
Retrieve a service / instance's presence info.
```javascript
/**
 * @name getServicePresence
 * @summary Retrieve a service / instance's presence info.
 * @param {string} name - service name - note service name is case insensitive
 * @return {promise} promise - which resolves with service presence
 */
getServicePresence(name)
```

#### getInstanceID
Returns the instance id for this process.
```javascript
/**
* @name getInstanceID
* @summary Return the instance id for this process
* @return {number} id - instanceID
*/
getInstanceID()
```

## Health
#### sendToHealthLog
Log a message to the service's health log queue.
```javascript
/**
 * @name sendToHealthLog
 * @summary Log a message to the service instance's health log queue.
 * @private
 * @throws Throws an error if this machine isn't a instance.
 * @param {string} type - type of message ('error', 'info', 'debug' or user defined)
 * @param {string} message - message to log
 */
sendToHealthLog(type, message)
```

#### getServiceHealthLog
Get this service's health log.
```javascript
/**
 * @name getServiceHealthLog
 * @summary Get this service's health log.
 * @throws Throws an error if this machine isn't a instance
 * @param {string} name - name of instance, use getName() if current service is the target.
 *                        note service name is case insensitive.
 * @return {promise} promise - resolves to log entries
 */
getServiceHealthLog(name)
```

#### getServiceHealthAll
Retrieves the health status of all instance services.
```javascript
/**
 * @name getServiceHealthAll
 * @summary Retrieve the health status of all instance services.
 * @return {promise} promise - resolves with an array of objects containing instance health information.
 */
getServiceHealthAll()
```

## Messaging
#### createUMFMessage
Create a UMF style message.
```javascript
/**
 * @name createUMFMessage
 * @summary Create a UMF style message.
 * @description This is a helper function which helps format a UMF style message.
 *              The caller is responsible for ensuring that required fields such as
 *              "to", "from" and "body" are provided either before or after using
 *              this function.
 * @param {object} message - optional message overrides.
 * @return {object} message - a UMF formatted message.
 */
createUMFMessage(message)
```

#### makeAPIRequest
Makes an API request to a hydra service.
```javascript
/**
 * @name makeAPIRequest
 * @summary Makes an API request to a hydra service.
 * @description If the service isn't present and the message object has its
 *              message.body.fallbackToQueue value set to true, then the
 *              message will be sent to the services message queue.
 * @param {object} message - UMF formatted message
 * @return {promise} promise - response from API in resolved promise or
 *                   error in rejected promise.
 */
makeAPIRequest(message)
```

#### sendMessage
Sends a message to all present instances of a  hydra service.
```javascript
/**
 * @name sendMessage
 * @summary Sends a message to all present instances of a  hydra service.
 * @param {string | object} message - Plain string or UMF formatted message object
 * @return {promise} promise - resolved promise if sent or
 *                   error in rejected promise.
 */
sendMessage(message)
```


#### sendReplyMessage
Sends a reply message based on the original message received.
```javascript
/**
 * @name sendReplyMessage
 * @summary Sends a reply message based on the original message received.
 * @param {object} originalMessage - UMF formatted message object
 * @param {object} messageResponse - UMF formatted message object
 * @return {object} promise - resolved promise if sent or
 *                   error in rejected promise.
 */
sendReplyMessage(originalMessage, messageResponse)
```

## Routing
#### registerRoutes
Registers routes.
```javascript
/**
* @name registerRoutes
* @summary Register routes
* @note Routes must be formatted as UMF To routes. https://github.com/cjus/umf#%20To%20field%20(routing)
* @param {array} routes - array of routes
* @return {object} Promise - resolving or rejecting
*/
registerRoutes(routes)
```

#### getAllServiceRoutes
Retrieves all service routes.
```javascript
/**
* @name getAllServiceRoutes
* @summary Retrieve all service routes.
* @return {object} Promise - resolving to an object with keys and arrays of routes
*/
getAllServiceRoutes()
```

#### matchRoute
Matches a route path to a list of registered routes
```javascript
/**
* @name matchRoute
* @summary Matches a route path to a list of registered routes
* @private
* @param {string} routePath - a URL path to match
* @return {boolean} match - true if match, false if not
*/
matchRoute(routePath)
```

## Message queues

#### queueMessage
Queues a message
```javascript
/**
* @name queueMessage
* @summary Queue a message
* @param {object} message - UMF message to queue
* @return {promise} promise - resolving to the message that was queued or a rejection.
*/
queueMessage(message)
```

#### getQueuedMessage
Retrieves a queued message
```javascript
/**
* @name getQueuedMessage
* @summary Retrieve a queued message
* @param {string} serviceName who's queue might provide a message
* @return {promise} promise - resolving to the message that was dequeued or a rejection.
*/
getQueuedMessage(serviceName)
```

#### markQueueMessage
Marks a queued message as either completed or not
```javascript
/**
* @name markQueueMessage
* @summary Mark a queued message as either completed or not
* @param {object} message - message in question
* @param {boolean} completed - (true / false)
* @param {string} reason - if not completed this is the reason processing failed
* @return {promise} promise - resolving to the message that was dequeued or a rejection.
*/
markQueueMessage(message, completed, reason)
```

# Hydra plugins

See the [Plugin documentation](/plugins.md).
