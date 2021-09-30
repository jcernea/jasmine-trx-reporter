'use strict'
var TRX = require('node-trx'),
  fs = require('fs'),
  os = require('os'),
  path = require('path'),
  uuid = require('uuid'), // uuid for screenshots file names. Already used by node-trx
  mkdirp = require('mkdirp')
/**
 *
 * @param {Object} jasmineTrxConfig - TRX Reporter Configuration
 * @param {String} [jasmineTrxConfig.browser] - Browser name to use in suites
 * @param {boolean} [jasmineTrxConfig.groupSuitesIntoSingleFile] - Builds unsharded (single file) suite
 * @param {string} [jasmineTrxConfig.reportName] - Report title
 * @param {boolean} [jasmineTrxConfig.takeScreenshot=true] - Take screenshots on each test
 * @param {boolean} [jasmineTrxConfig.takeScreenshotsOnlyOnFailures=false] - Take screenshots only on failing tests
 * @param {string} [jasmineTrxConfig.outputFile=Default.trx] - Output file name
 * @param {string} jasmineTrxConfig.folder - Output folder name
 * @param {boolean} [jasmineTrxConfig.extraAttachments] - Attach extra content (spec.extraFiles[])
 */
module.exports = function (jasmineTrxConfig) {
  //console.log('Adding TRX reporter: ' + reportName + ' - ' + outputFile + ' - ' + browserStr + ' - ' + groupingSuites);

  var run = {},
    computerName = os.hostname(),
    browser = jasmineTrxConfig.browser || '',
    userName = process.env.USERNAME,
    suiteName = '',
    groupingSuites = jasmineTrxConfig.groupSuitesIntoSingleFile,
    outputFolder = jasmineTrxConfig.folder || '',
    outputFile = buildOutputFilePath(jasmineTrxConfig),
    reportName = jasmineTrxConfig.reportName || '',
    takeScreenshotsOnlyOnFailures =
      jasmineTrxConfig.takeScreenshotsOnlyOnFailures || false,
    takeScreenshots = jasmineTrxConfig.takeScreenshots || false,
    extraAttachments = jasmineTrxConfig.extraAttachments || false,
    outputScreenshotsFolder

  if (groupingSuites) {
    groupingSuites = true
  } else {
    groupingSuites = false
  }
  //console.log('groupingSuites: ' + groupingSuites);

  function buildOutputFilePath(jasmineTrxConfig) {
    ensureFolderExists(outputFolder)
    if (jasmineTrxConfig.outputFile) {
      return (
        buildFolderPath(outputFolder) +
          buildBrowserPath() +
          jasmineTrxConfig.outputFile || 'Default.trx'
      )
    } else {
      return null
    }
  }

  function buildOutputFilePathBySuite(suite) {
    ensureFolderExists(outputFolder)
    return (
      buildFolderPath(outputFolder) +
        buildBrowserPath() +
        suite.description +
        '.trx' || 'Default.trx'
    )
  }

  this.jasmineStarted = function (suiteInfo) {
    //console.log('jasmineStarted: ' + suiteInfo.totalSpecsDefined + ' specs found');
    if (groupingSuites == true) {
      this.beginTestRun()
    }
  }

  this.suiteStarted = function (suite) {
    //console.log('suiteStarted: ' + suite.fullName);

    if (outputFile == null) {
      outputFile = buildOutputFilePathBySuite(suite)
    }

    outputScreenshotsFolder = outputFile.replace('.trx', '')

    if (groupingSuites == false) {
      this.beginTestRun()
    }

    suiteName = suite.description
  }

  this.beginTestRun = function () {
    var suiteStartTime = getTimestamp(new Date())
    run = new TRX.TestRun({
      name: reportName,
      runUser: process.env.USERNAME,
      times: {
        creation: suiteStartTime,
        queuing: suiteStartTime,
        start: suiteStartTime,
        finish: suiteStartTime,
      },
      deployment: {
        // if we want attach files with the tests results, we need to specify the folder where thoses results are.
        // we will create a folder with the same name as the file (its what Visual Studio does by default).
        runDeploymentRoot: path.basename(outputFile.replace('.trx', '')),
      },
    })
  }

  this.specStarted = function (spec) {
    //console.log('specStarted: ' + spec.description);

    spec.startTime = new Date()
    run.times.start = getTimestamp(spec.startTime)
    if (!spec.startTime) {
      spec.startTime = spec.startTime
    }

    /* Attach to currentSpec */
    jasmine.getEnv().currentSpec = spec
  }

  this.specDone = async function (spec) {
    spec.finished_at = new Date()
    var specRunTime = calculateRunTime(spec)
    var success = spec.failedExpectations.length === 0
    var result = {
      test: new TRX.UnitTest({
        name: suiteName + ' - ' + spec.description + ' - ' + browser,
        methodName: spec.description,
        methodCodeBase: 'protractor-jasmine',
        methodClassName: suiteName,
        description: spec.description + ' - ' + browser,
      }),
      computerName: computerName,
      outcome: success ? 'Passed' : 'Failed',
      duration: specRunTime,
      startTime: getTimestamp(spec.startTime),
      endTime: getTimestamp(spec.finished_at),
    }
    if (success === false) {
      result.output = combineProperties(spec.failedExpectations, 'message')
      result.errorMessage = combineProperties(
        spec.failedExpectations,
        'message'
      )
      result.errorStacktrace = combineProperties(
        spec.failedExpectations,
        'stack'
      )
    }

    // check if we should take a screenshot always or only when a spec fails
    if ((takeScreenshotsOnlyOnFailures && !success) || takeScreenshots) {
      await attachScreenshot(result)
    }

    /* Check for additional attachments, copy them over and attach to spec */
    if(extraAttachments) await attachExtras(jasmine.getEnv().currentSpec, result)

    run.addResult(result)
  }

  async function attachExtras(currentSpec, trxResult) {
    /* Additional file attachments specified in tests */
    const extraFiles = currentSpec.extraFiles
    if (extraFiles) {
      for (var filePath of extraFiles) {
        /*Copy file over to TRX test loc*/
        const screenshotUUID = uuid.v4()
        const newFile = path.join(
          outputScreenshotsFolder,
          'In',
          trxResult.executionId,
          screenshotUUID + '.png'
        )

        await new Promise((res, rej) => {
          fs.copyFile(filePath, newFile, (err) => {
            if (err) rej(err)

            trxResult.resultFiles.push({ path: screenshotUUID + '.png' })
            res(true)
          })
        })
      }
    }
  }

  async function attachScreenshot(testResult) {
    var screenShotName = uuid.v4()
    testResult.executionId = testResult.executionId || uuid.v4()
    testResult.resultFiles = [{ path: screenShotName + '.png' }]

    // trx attachments for a test are expected to reside on a folder with the same name as the executionId
    ensureFolderExists(
      path.join(outputScreenshotsFolder, 'In', testResult.executionId)
    )

    if (global.browser && global.browser.takeScreenshot) {
      return takeScreenshot(
        path.join(
          outputScreenshotsFolder,
          'In',
          testResult.executionId,
          screenShotName + '.png'
        )
      )
    }
  }

  this.suiteDone = async function (result) {
    //console.log('suiteDone: ' + result.fullName);

    if (groupingSuites == false) {
      this.writeResultFile()
      outputFile = null
    }
  }

  this.jasmineDone = function () {
    //console.log('jasmineDone');
    if (groupingSuites == true) {
      this.writeResultFile()
    }
  }

  this.writeResultFile = function () {
    //console.log('write ' + outputFile);
    if (outputFile) {
      run.times.finish = getTimestamp(new Date())
      fs.writeFileSync(outputFile, run.toXml())
    }
  }

  function getTimestamp(date) {
    function pad(n) {
      return n < 10 ? '0' + n : n
    }
    var currentDate = date !== undefined ? date : new Date(),
      month = currentDate.getMonth() + 1,
      day = currentDate.getDate()
    return (
      currentDate.getFullYear() +
      '-' +
      pad(month) +
      '-' +
      pad(day) +
      ' ' +
      pad(currentDate.getHours()) +
      ':' +
      pad(currentDate.getMinutes()) +
      ':' +
      pad(currentDate.getSeconds())
    )
  }

  function calculateRunTime(spec) {
    var specRunTime = (spec.finished_at - spec.startTime) / 1000
    specRunTime = isNaN(specRunTime) ? 0.001 : specRunTime

    var newDate = new Date(null)
    var splitSeconds = specRunTime.toString().split('.')
    if (splitSeconds.length == 2) {
      newDate.setUTCSeconds(splitSeconds[0], splitSeconds[1])
    } else {
      newDate.setUTCSeconds(splitSeconds[0])
    }
    var dateStr = newDate.toISOString().substr(11, 12)
    return dateStr
  }

  function combineProperties(collection, property) {
    var combined = ''
    for (var i = 0; i < collection.length; i++) {
      combined = combined + ' - ' + collection[i][property]
    }
    return combined
  }

  function buildFolderPath(outputFolder) {
    if (outputFolder) {
      return outputFolder + '/'
    } else {
      return ''
    }
  }

  function buildBrowserPath() {
    if (browser) {
      return browser + '_'
    } else {
      return ''
    }
  }

  function ensureFolderExists(path) {
    if (path) {
      // replacing with mkdirp, because it works recursively
      mkdirp(path, function (err) {
        if (err) {
          if (err.code == 'EEXIST') {
            //AOK
          } else {
            console.error('Error creating trx output folder: ' + err)
          }
        }
      })
    }
  }

  async function takeScreenshot(fileName) {
    return global.browser.takeScreenshot().then(async function (png) {
      return writeScreenshot(png, fileName)
    })
  }

  async function writeScreenshot(data, filename) {
    return new Promise((res, rej) => {
      var stream = fs.createWriteStream(filename)
      stream.write(Buffer.from(data, 'base64'))
      stream.end()
      res(true)
    })
  }
}
