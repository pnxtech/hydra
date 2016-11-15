# Hydra Express Quick Start Guide

Hydra is an NPM module for quickly building Node-based Microservices. Hydra-express is a module which wraps Hydra and ExpressJS. In this guide we'll look at building a hydra-express app and seeing what it can do.

## Step 1 - Get Redis
Hydra requires the use of a [Redis](http://redis.io/) server. If you've never used Redis before we think it will be life changing dev experience and hopefully this is a good reason to finally try it!

If you're already using Redis then congratulations you've already leveled up, feel free to skip to step 2!

There are lots of ways to obtain access to a Redis server.  One of the easiest ways is to sign up for a free tier via a provider such as [RedisLabs](https://redislabs.com/pricing). 

If you're comfortable with Docker you can install the [official Redis image](https://hub.docker.com/_/redis/) in just minutes. This is a nice option for PC users.

On a mac you can install Redis via [Homebrew](http://brew.sh/) using one easy command: `brew install redis`.  But if you rather not install Homebrew then you can install Redis [this way](http://jasdeep.ca/2012/05/installing-redis-on-mac-os-x/)

For PC users not using Docker, Microsoft maintains this [project](https://github.com/MSOpenTech/redis)

And if you don't mind build Redis from source checkout the [Redis Quick Start Guide](http://redis.io/topics/quickstart)

But the easiest way is the first option, which doesn't require an install - just sign up with a free tier cloud provider.

## Step 2 - Grab hydra CLI tools

With access to Redis you should now install the hydra tools:

> Make sure you're using NodeJS 6.2.1 or greater - Hydra is built using ES6!

```shell
$ sudo npm install -g yo generator-fwsp-hydra hydra-cli
```

That installs the handly Yeoman and hydra generator and commandline client.

Let's configure the hydra commandline client.

```shell
$ hydra-cli config
redisUrl: 127.0.0.1
redisPort: 6379
redisDb: 15
```

The above example assumes you have redis installed locally. If not, simply provide the `redisUrl` and `redisDb` that your cloud service provided.

Now we're all set. Let's build a microservice!

## Step 3 - Build and test a microservice

Let's build a service called hello. We'll mostly just select the defaults.

```shell
$ yo fwsp-hydra
? Name of the service (`-service` will be appended automatically) hello
? Host the service runs on? 
? Port the service runs on? 0
? What does this service do? Says hello
? Does this service need auth? No
? Is this a hydra-express service? Yes
? Set up a view engine? No
? Enable CORS on serverResponses? No
? Run npm install? No
   create hello-service/.editorconfig
   create hello-service/.eslintrc
   create hello-service/.gitattributes
   create hello-service/.nvmrc
   create hello-service/.jscsrc
   create hello-service/specs/test.js
   create hello-service/specs/helpers/chai.js
   create hello-service/.gitignore
   create hello-service/package.json
   create hello-service/README.md
   create hello-service/hello-service.js
   create hello-service/config/sample-config.json
   create hello-service/config/config.json
   create hello-service/routes/hello-v1-routes.js

Done!
'cd hello-service' then 'npm install' and 'npm start'
```

Here's what was created: 
```
.
├── README.md
├── config
│   ├── config.json
│   └── sample-config.json
├── hello-service.js
├── node_modules
├── package.json
├── routes
│   └── hello-v1-routes.js
└── specs
    ├── helpers
    └── test.js
```

Edit the `routes/hello-v1-routes.js` to make things more interesting.
Change line 18 from: 

```javascript
   result: {}
```

to: 

```javascript
    result: {
      msg: `${hydra.getServiceName()} - ${hydra.getInstanceID()}`
    }  
```

Following the instructions above we can continue to build our service.

```shell
$ cd hello-service
$ npm install
$ npm start
```

After starting the service we see that it launched using a random port.

```javascript
serviceInfo { serviceName: 'hello-service',
  serviceIP: '10.1.1.163',
  servicePort: 8891 }
```

You can access the service via curl:

```shell
$ curl 10.1.1.163:8891/v1/hello
{"statusCode":200,"statusMessage":"OK","statusDescription":"Request succeeded without error","result":{"msg":"hello-service - 50bf4346dd492c2036cfd57ad8bd2844"}}
```

or via your browser: `http://10.1.1.163:8891/v1/hello`

We can also use the hydra-cli app we installed to obtain information about our service:

```
$ hydra-cli nodes
[
  {
    "serviceName": "hello-service",
    "serviceDescription": "Says hello",
    "version": "0.0.1",
    "instanceID": "b1554f404acc3268c1511dc84ae43c50",
    "updatedOn": "2016-11-15T18:18:56.438Z",
    "processID": 20542,
    "ip": "10.1.1.163",
    "port": 8891,
    "elapsed": 4
  }
]
```

```
$ hydra-cli routes
{
  "hello-service": [
    "[GET]/_config/hello-service",
    "[get]/v1/hello/"
  ]
}
```

This information is being emitted by our service and it allows services to discover one another and send messages to each other.  Combined with the [Hydra-Router](https://github.com/flywheelsports/fwsp-hydra-router) you can build an entire network of microservices.

To found out what you can do with your new microservice see the [Hydra methods](https://github.com/flywheelsports/fwsp-hydra/blob/master/documentation.md#hydra-methods).
