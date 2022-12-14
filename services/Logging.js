import winston from 'winston'

const logger = expandErrors(winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({ format: winston.format.simple() }),
  ]
}))

// Extend a winston by making it expand errors when passed in as the
// second argument (the first argument is the log level).
function expandErrors(logger) {
  var oldLogFunc = logger.log;
  logger.log = function() {
    var args = Array.prototype.slice.call(arguments, 0);
    if (args.length >= 2 && args[1] instanceof Error) {
      args[1] = args[1].stack;
    }
    return oldLogFunc.apply(this, args);
  };
  return logger;
}

export default class Logging {
  static log(message) {
    logger.log('info', message)
  }

  static logError (message) {
    logger.log('error', message)
  }
}
