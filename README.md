![](hydra.jpg)

# Hydra

Hydra is a module designed to enable the construction of microservices and/or enable non-service applications to discover and utilize microservices. As such, Hydra helps address a broad class of concerns when building distributed applications.

> ☕ This project was named after [Hydra](https://en.wikipedia.org/wiki/Hydra_(Dungeons_%26_Dragons)), a mythical multi-headed beast from Greek and Roman mythology.
> Each head capable of acting independently while achieving an objective. That plays nicely with the idea of multiple processes working to provide a service.

While Hydra is implemented for NodeJS, the functionality it enables can be implemented for other platforms. The core intermediary service dependency is on a shared Redis instance or cluster such as Amazon's ElasticCache.

As an Node module, Hydra provides drop-in functionality which is designed to address the following microservice concerns:

* **Service Registration**: allowing services to register themselves when they come online and to publish their HTTP API routes.
* **API Routability**: allows API calls to be routed to a microservice.
* **Messaging Communication**: Inter-service communication via publish and subscribe channels and Message Queues.
* **Service Load Balancing**: automatically load balances requests based on available (present) instances of a microservice.
* **Service Discovery**: locating services without having to hardcode their IP addresses and Port information.
* **Health Reporting**: Automatic health check reporting. To answer questions such as: Is the application healthy? Is it functioning properly?
* **Presence Reporting**: Is an instance of service actually available?

> ☕ If you're using ExpressJS to build your microservice you should consider using the [Hydra-Express](https://github.com/flywheelsports/hydra-express) module which provides ExpressJS bindings and a higher level of abstraction.

In this document we'll refer to `services` and `service instances`. A Service Instance and Service Node refers to the same thing. A service is simply the name given to one or more service instances. Consider it a class of service. For example, we might have a service to handle image resizing, and we might simple call that service `image-resizer`. In our cloud infrastructure we might have three instances of the image-resizer service running, in response to high demand.  Each instance is a service instance or node.

In Hydra, a service instance is simply a process which uses Hydra to handle microservice concerns.

> ☕ For a quick overview of what Hydra offers refer to the end of this document for a list of public methods.

# Installing Hydra

To use Hydra from another project:

```
$ npm i @flywheelsports/hydra
```

To contribute and develop locally:

```
$ npm install
$ npm init
```

The NPM Init command above registers the Hydra NPM package locally.  When attempting to utilize this Hydra package from within your application, you should go to your project's root and type:

```
$ npm init hydra
```

Once Hydra NPM sits inside of a private NPM repo then the above steps will only be useful when working on the Hydra NPM module itself.

# Using Hydra

## Importing Hydra

To load Hydra simply import it:

```javascript
const hydra = require('@flywheelsports/hydra');
```

## Initialization

On import, the Hydra module is loaded but must first be initialized before it can be used.

```javascript
hydra.init(initObject);
```

The initialization object consist of the following fields:

```javascript
hydra: {
  serviceName: 'hydramcp',
  serviceDescription: 'Hydra Master Control Program',
  serviceIP: '',
  servicePort: 0,
  serviceType: 'mcp',
  redis: {
    url: '127.0.0.1',
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
      url: '127.0.0.1',
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

## Hydra modes

Hydra may be configured for used in one of two modes:

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

If a consumer mode application calls a service mode related method an exception or failed promise will result. Each call is clearly documented at the end of this document to help avoid misuse. But as always, make sure your application is adequately tested.

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

Additionally, Hydra maintains an internal log where it stores issues it detects. We can think of this as a block box flight recorder.

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
makeAPIRequest | Makes and API request to the named service.

> Refer to the end of this document for a complete listing of Hydra functions.

## Messaging

Hydra supports inter-service communication in the following ways:

* Discovery and direct use of the server's networking info (IP and Port).
* Through the use of the `makeAPIRequest` method.
* Using pub/sub channels.
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

> Note: using the above approach should first be preceded by a check to see whether the service is available using the `getServicePresence` method. After all, we want to make sure the service is both registered and currently available.

This is where using Hydra's `makeAPIRequest` method ends up being easier and less error prone. The `makeAPIRequest` method accepts an object which contains the service's name along with other useful (but optional) information. The method automatically handles checking for service availability and can even push the message (request) to the service's message queue if the service is temporally unavailable. This is optional behavior and presumes that that this is acceptable to the sender and that the remote service is capable of handling the request as a queued message.

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

### Redis-based pub/sub

Hydra enabled services can send and receive messages as publishers and/or subscribers.

As a publisher, a service can use the `openPublisherChannel` method to open a channel on which to publish messages. Then it can use `publishToChannel` method to send a message to an open channel.

```javascript
hydra.openPublisherChannel('hydra:test');
setInterval(() => {
  let message = hydra.createUMFMessage({
    to: 'hydra:test',
    from: 'blue-service:/',
    body: {
      timestamp: parseInt(new Date().getTime() / 1000)
    }
  });
  hydra.publishToChannel('hydra:test', message);
}, 5000);
```

When a publisher no longer needs to keep a channel open it should close it using the `closePublisherChannel` method.

As a subscriber, a service can listen to messages on a channel:

```javascript
hydra.openSubscriberChannel('hydra:test');
hydra.subscribeToChannel('hydra:test', function(message) {
  console.log(message);
});
```

When a service no longer needs to listen to a channel it should close it using the `closeSubscriberChannel` method.

Pub/sub offers services the following key benefits:

* messages don't require the overhead of HTTP headers.
* communication is relatively immediate compared to HTTP API based polling.
* messages can be received by multiple listeners.
* defining communication channels is as simple as specifying a topic name.

#### Built-in message channel

Every hydra service automatically listens to a built-in channel where messages sent from other services arrive.

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

To send a message to a service you can use the `sendMessage` call.

```javascript
let message = hydra.createUMFMessage({
  to: 'hydra:test',
  from: 'blue-service:/',
  body: {
    fileData: '{base64}'
  }
});
hydra.sendMessage('upload-service', message);
```

The first parameter is the name of the service you want to send a message to, and the second parameter is a UMF formatted object containing a message.

When sendMessage is used the message is sent to all service instances! This may not be what you intended. What if you only want one service instance to handle the incoming message? You should then use a job queue (create your own in Redis or the database of your choice) and only use sendMessage to let services instances know that there are new messages available for processing.

> Warning: Although you can use `sendMessage` to send and to respond to messages it's recommended to use `sendReplyMessage` when replying. The reason for this is that sendReplyMessage uses the source message to properly fill out UMF fields required for robust messaging. This includes things like using the source mid, for, to, from UMF fields to formulate a reply message.

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

The additional fields are defined by the UMF specification and aid Hydra and other distributed systems in the handling of messages.  

The `createUMFMessage` helper method helps ensure that we're starting with a properly formatted UMF compatible message which we can further extend.

For example, here we can change the `priority` and `type` of the message before passing it along to the `makeAPIRequest` method.

```javascript
message.priority = 'high';
message.type = 'service:control';
```

It's important to note that we could have also added the `priority` and `type` fields to our original message that was passed to `createUMFMessage`. The method will use your supplied fields to overwrite the ones it creates by default.  So it's important to not overwrite `mid` or `timestamp` in careless ways.

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
* Events - pub/sub

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
Find a service.
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
Return the instance id for this process.
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
Retrieve the health status of all instance services.
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

#### broadcastAPIRequest
Broadcasts an API request to all present instances of a  hydra service.
```javascript
/**
 * @name broadcastAPIRequest
 * @summary Broadcasts an API request to all present instances of a  hydra service.
 * @param {object} message - UMF formatted message
 * @return {promise} promise - response from API in resolved promise or
 *                   error in rejected promise.
 */
broadcastAPIRequest(message)
```

#### sendMessage
Sends a message to all present instances of a  hydra service.
```javascript
/**
 * @name sendMessage
 * @summary Sends a message to all present instances of a  hydra service.
 * @param {string} serviceName - Name of service
 * @param {string | object} message - Plain string or UMF formatted message object
 * @return {promise} promise - resolved promise if sent or
 *                   error in rejected promise.
 */
sendMessage(serviceName, message)
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
Register routes.
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
Retrieve all service routes.
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

## Pub/Sub Events

#### openPublisherChannel
Open a publisher channel to send messages to subscribers.
```javascript
/**
* @name openPublisherChannel
* @summary Open a publisher channel to send messages to subscribers
* @param {string} topic - channel name (topic)
*/
openPublisherChannel(topic)
```

#### closePublisherChannel
Closes an open publisher channel
```javascript
/**
* @name closePublisherChannel
* @summary Closes an open publisher channel
* @param {string} topic - channel name (topic)
*/
closePublisherChannel(topic)
```

#### publishToChannel
Publish a message to an open channel.
```javascript
/**
* @name publishToChannel
* @summary Publish a UMF message to an open channel
* @param {string} topic - channel name (topic)
* @param {object} message - A UMF message object
*/
publishToChannel(topic, message) {
  super._publishToChannel(topic, message);
}
```

#### openSubscriberChannel
Open a subscriber channel to receive messages on a given topic.
```javascript
/**
* @name openSubscriberChannel
* @summary Open a subscriber channel to receive messages on a given topic
* @param {string} topic - channel name (topic) to subscribe to
*/
openSubscriberChannel(topic)
```

#### closeSubscriberChannel
Close an open subscriber channel
```javascript
/**
* @name closeSubscriberChannel
* @summary Close an open subscriber channel
* @param {string} topic - channel name (topic)
*/
closeSubscriberChannel(topic)
```

#### subscribeToChannel
Subscribe to an open channel.
```javascript
/**
* @name subscribeToChannel
* @summary Subscribe to an open channel
* @param {string} topic - channel name
* @param {object} callback - function callback(message) to receive messages.
*/
subscribeToChannel(topic, callback)
```

## Message queues

#### queueMessage
Queue a message
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
Retrieve a queued message
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
Mark a queued message as either completed or not
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
