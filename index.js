/**
 * File: core/tbxi-tools.js
 * 
 * Last Modified: 5/5/2020
 *
 * Version: 1.0
 * Revision: R-000002
 * 
 * Author: TBXI - Corey Brochu
 * 
 * Purpose: Shared functionality between projects, utilities and
 *          convenience functions.
 * 
 * Export Notes: ...
 * 
 * Design Notes: ...
 */

const { promisify } = require('util');
const log4js = require('log4js');

const MODULE = module.exports = {

  isDef: valueIsDefined,
  isNDef: val => !valueIsDefined(val),
  isFunc: valueIsFunction,
  isNFunc: val => !valueIsFunction(val),

  isPromise: valueIsPromise, // TODO: Fix this?
  isNPromise: val => !valueIsPromise(val),

  deepCopy: deepCopy,
  echo: echo,

  syncer: {
    new: syncer,
  },
  sync: sync,
  waitFor: waitFor,
  pause: pause,
  awaitCallback: awaitCallback,

  setupLogs: logSetup,
  log: logDebugMessage,
  logData: logDebugData,
  error: logErrorMessage,
  errorData: logErrorData,

  // Include selector method for wrapped utilities
  '_': (selector) => {
    /**
     * Produce an interface to the module based on a (possibly blank) selector object.
     * When appropriate the selector will be wrapped and sent back with bound methods.
     */

    if (isNDef(selector)) return MODULE

    switch (true) {

      case (typeof selector == 'string'):
        {

          let wrapper = {};

          wrapper.arg = selector;

          wrapper.search = STRING.textSearch.bind(wrapper);
          wrapper.match = STRING.textMatch.bind(wrapper);


          return wrapper;
        }
        break;

    }

    throw "Xenon Error: No selector was provided to the Xe() selector function"
  }
}

/** Module exports and global registrations */
global.isDef = MODULE.isDef;
global.isNDef = MODULE.isNDef;

global.isFunc = MODULE.isFunc;
global.isNFunc = MODULE.isNFunc;

global.isPromise = MODULE.isPromise;
global.isNPromise = MODULE.isNPromise;

//global.deepCopy = MODULE.deepCopy;



/** General Library functions */
function valueIsDefined(val) {

  return (val !== null && val !== undefined)
}

function valueIsFunction(val) {

  return (typeof (val) === 'function')
}

function valueIsPromise(val) {

  return (valueIsDefined(val) && valueIsFunction(val.then))
}

function deepCopy(obj) {
  
  // Guard against a nullish value
  if (obj == undefined || obj == null) obj = {};
  
  return JSON.parse(JSON.stringify(obj))
}

function echo(obj) {

  return JSON.stringify(obj || null)
}

/** Async utility functions */

function syncer(){
  /**
   * Generate a promise and return only its resolver,
   * for the purpose of manual synchronization and pause
   * / delay type tasks.
   */

  let resume;
  let syncer = new Promise((resolver)=>{
    resume = resolver;
  });

  return {resume, syncer}
}

function sync(thenable, opts) {

  let {
    timeout,
    onDone,
    discardOnTimeout,
    onTimeout
  } = opts || {};

  let synchronizer = {
    done: false,
    value: null,
    error: null
  }

  // Guard against non-thenable objects, and return value immediately
  if (!valueIsPromise(thenable)) {

    console.log('TBXTools.js: sync(): promise argument is not thenable.')

    synchronizer.done = true;
    synchronizer.value = thenable;
    synchronizer.error = "NON_THENABLE"

    return synchronizer;
  }

  thenable.then((result) => {

    if (synchronizer.done && discardOnTimeout) return; // Guard against premature completion

    synchronizer.done = true;
    synchronizer.value = result

    if (valueIsFunction(onDone)) onDone(synchronizer)

  }, (error) => {

    if (synchronizer.done && discardOnTimeout) return; // Guard against premature completion

    synchronizer.done = true;
    synchronizer.value = null;
    synchronizer.error = error;

    if (valueIsFunction(onDone)) onDone(synchronizer)
  })

  if (valueIsDefined(timeout)) {

    setTimeout(() => { // Guard against timeout
      if (synchronizer.done != true) {
        synchronizer.error = "TIMED_OUT"
        synchronizer.done = true

        if (valueIsFunction(onTimeout)) onTimeout(synchronizer)
        //if (valueIsFunction(onDone) && !valueIsFunction(onTimeout)) onDone(synchronizer)
      }
    }, timeout)
  }

  return synchronizer
}

function waitFor(synchronizer, timeout, opts) {

  /** Handle special case where synchronizer is array of synchronizers */
  if (valueIsDefined(synchronizer) && synchronizer.length > 0) return waitForAll(synchronizer, timeout, opts)

  // Default options
  let {
    onDone,
    onTimeout,
    interval
  } = opts || {};

  if (!(interval >= 150)) interval = 150 // Guard against very low or non-numerical check timers

  let res;
  isResolved = false;

  let timer = new Promise((resolve, reject) => {

    res = resolve;
  })

  /** Handle special case where synchronizer is actually a thenable promise-like object */
  if (valueIsPromise(synchronizer)) synchronizer = sync(synchronizer);

  /** Apply a timeout limitation if specified, for the promise we create (not for the syncing object) */
  if (valueIsDefined(timeout)) {

    setTimeout(() => {

      if (synchronizer.done != true && !isResolved) {

        if (valueIsFunction(onTimeout)) onTimeout(synchronizer)
      }

      if (!isResolved) res();

    }, timeout)
  }

  /** Always check periodically to see if we have any change in synchronizer status */ // TODO: Rework this into an integrated runtime
  let intID = setInterval(() => {

    if (synchronizer.done || valueIsDefined(synchronizer.error)) {

      clearInterval(intID)

      isResolved = true;
      if (valueIsFunction(onDone)) onDone(synchronizer)

      res();
    }
  }, interval || 150)


  return timer;
}

function waitForAll(synchronizers, timeout, opts) {

  /** Iterate over list of synchronizer like objects (thenable or pure syncer) */
  let promiseList = []
  for (let syncer of synchronizers) {

    promiseList.push(waitFor(syncer, timeout, opts))
  }

  return Promise.all(promiseList);
}

function pause(timeout, resumeTrigger) {

  let res;

  let timer = new Promise((resolve, reject) => {

    res = resolve;
  })

  setTimeout(() => {

    res()
  }, timeout || 0)

  // Attach resume method to object if passed
  if (valueIsDefined(resumeTrigger)) resumeTrigger.resume = res;

  return timer
}

function poll(testFunction, timeout, opts) {
  /**
   * Run a test function every 150ms by default, and finish a promise
   * once the function returns a truthy value.
   */
  
  let {
    onDone,
    onTimeout,
    interval
  } = opts || {};

  let synchronizer = {
    done: false,
    value: null,
    error: null
  }
  
  let res; let rej;
  isResolved = false;
  
  let timer = new Promise((resolve, reject) => {

    res = resolve;
    rej = reject;
  })
  
  // Guard against non-function objects, and return value immediately
  if (!valueIsFunction(testFunction)) {

    console.log('TBXTools.js: poll(): polling test argument is not a function.')

    synchronizer.done = true;
    synchronizer.value = testFunction;
    synchronizer.error = "NON_FUNCTION"
    
    rej(); // Invalidate the promise

    return timer;
  }
  
  /** Apply a timeout limitation if specified, for the promise we create (not for the syncing object) */
  if (valueIsDefined(timeout) && (timeout >= 0)) {

    setTimeout(() => {

      if (synchronizer.done != true && !isResolved) {
         
        synchronizer.error = "TIMED_OUT"
        synchronizer.done = true
        
        if (valueIsFunction(onTimeout)) onTimeout(synchronizer)
      }

      if (!isResolved) res();

    }, timeout)
  }

  /** Always check periodically to see if we have any change in synchronizer status */ // TODO: Rework this into an integrated runtime
  let intID = setInterval(() => {

    if (synchronizer.done || valueIsDefined(synchronizer.error)) {

      clearInterval(intID)

      isResolved = true;
      if (valueIsFunction(onDone)) onDone(synchronizer)

      res();
    } else { // Run test Function
      
      if (testFunction && (testFunction() == true)) {
       
        // Resolve the timer as we have now succeeded polling.
        
        synchronizer.done = true
        
        clearInterval(intID)

        isResolved = true;
        if (valueIsFunction(onDone)) onDone(synchronizer)

        res();
      }
    }
  }, interval || 150)
  
  return timer;
}

function awaitCallback(callback, timeout, opts) {

  if (valueIsFunction(callback) && !valueIsPromise(callback)) {

    return waitFor(promisify(callback), timeout, opts)
  } else {

    let message = 'TBXTools.js: awaitCallback(): callback was not a function.'
    console.error(message)

    throw message
  }
}

/** Helper data analysis functions, using annotations to pass auxiliary data */

const STRING = {

  textSearch: function (regex) {
    /**
     * WRAPPER METHOD - Arg from 'this' is provided at binding time
     * 
     * Takes a source string and applies the regular search function to it,
     * returning an annotated boolean with the value attached when true. Boolean is
     * true if the regex is found, false if it is not found. Returns a false value
     * when nothing is found, since the value is always superfluous.
     */

    let value = this.arg.search(regex)

    let result = new Boolean(value != -1)

    result.value = value

    if (result == false) result = false

    return result
  },

  textMatch: function (regex) {
    /**
     * WRAPPER METHOD - Arg from 'this' is provided at binding time
     * 
     * Takes a source string and applies the regular match function to it,
     * returning an annotated boolean with the value attached, along with a count of matches. Boolean is
     * true if the regex is found, false if it is not found.
     */

    let value = this.arg.match(regex)

    let result = new Boolean(value)

    result.value = value = value || []
    result.count = value.length

    return result
  },

}

/** Log4JS Debug Logging */

function logSetup(configuration, opts){
  /**
   * Configure log4js logging system
   */

  if (configuration) log4js.configure(configuration)
}

function logDebugMessage(logInfo, selector, mode) {
  /**
   * Send debug logging to log4js, selecting some categories in a '|'
   * delimited striing and providing log data.
   */

  let loggers = [];
  let categories = (selector || '').split('|');

  for (category of categories){

    let logger = log4js.getLogger(category) || null;

    if (isDef(logger)) loggers.push(logger)
  }

  for (logger of loggers){

    switch (mode || null){

      case 'trace':

        logger.level = 'all'
        logger.trace(logInfo)
        break;

      default:

        logger = log4js.getLogger('default')

        if (!logger) break;

        logger.level = 'all'
        logger.debug(logInfo)

        console.log(logInfo)

        break;

      case 'debug':

        logger.level = 'all'
        logger.debug(logInfo)
        break;

      case 'info':

        logger.level = 'all'
        logger.info(logInfo)
        break;

      case 'warn':

        logger.level = 'all'
        logger.warn(logInfo)
        break;

      case 'error':

        logger.level = 'all'
        logger.error(logInfo)
        break;

      case 'fatal':

        logger.level = 'all'
        logger.fatal(logInfo)
        break;
    }
  }
}

function logDebugData(logInfo, logData, selector, mode) {
  /**
   * Send debug logging to log4js with a second argument for data
   * expansion, selecting some categories in a '|'
   * delimited string and providing log data.
   */

  logDebugMessage(logInfo + '\n' + JSON.stringify(logData), selector, mode)
}

function logErrorMessage(logInfo, selector, mode) {
  /**
   * Send error logging to log4js, selecting some categories in a '|'
   * delimited string and providing log data.
   */

  logDebugMessage(logInfo, selector, mode || 'error')
}

function logErrorData(logInfo, logData, selector, mode) {
  /**
   * Send error logging to log4js with a second argument for data
   * expansion, selecting some categories in a '|'
   * delimited string and providing log data.
   */

  logDebugMessage(logInfo + '\n' + JSON.stringify(logData), selector, mode || 'error')
}

/** Support Functions */
