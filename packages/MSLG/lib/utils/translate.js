/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const fetch = require('node-fetch');

const retCode = require('../enums/errorCodes');
const Exception = require('./exception')
const parserHelper = require('./parserHelper');
const parserConsts = require('../enums/parserconsts');
const translate = {
    /**
     * Async function to localize .lg files and write output files.
     * 
     * @param {string} inputLGFileName pointer to .lg file to localize
     * @param {string} toLang target langauge to localize content to
     * @param {string} translateKey Microsoft text translation API translation key
     * @param {string} lgFolder Input folder with .lg files
     * @param {string} outFolder Output folder to write generated content to
     * @param {string} srcLang Source content language
     * @param {boolean} includeSubFolder If true, will include .lg files found in sub folders
     * @param {string} outputFileName Folder path to write out localized files
     * @param {boolean} translateComments If true, comments in .lg files will be localized
     * @param {boolean} translateLinkText If true, link description text for .lg files will be localized
     * @param {boolean} verbose If true, write verbose log messages to console.log
     * @returns {void} Nothing
     * @throws {Exception} Throws on errors. Exception object includes errCode and text. 
     */
    translateContent: async function(args) {
        const inputLGFileName = args["in"];
        const toLang = (args["t"] || args["toLang"]);
        const translateKey = (args["k"] || args["translateKey"]);
        const lgFolder = (args["l"] || args["lgFolder"] || args["lg"]);
        const outFolder = (args["o"] || args["outFolder"]);
        const srcLang = (args["f"] || args["srcLang"]);
        const includeSubFolder = (args["s"] || args["subfolder"]);
        const outputFileName = (args["n"] || args["lgFile"]);
        const translateComments = (args["c"] || args["translateComments"]);
        const translateLinkText = (args["u"] || args["translateLinkText"]);
        const verbose = args["verbose"];

        let lOutputFolder;
        let lgFiles = [];
        if(inputLGFileName) lgFiles.push(inputLGFileName);
        // verify input & output folder (if specified) exists
        try {
            lOutputFolder = parserHelper.getOutputFolder(outFolder);
        } catch (err) {
            throw (err);
        }
        if(lgFolder) {
            try {
                let folderStat = fs.statSync(lgFolder);
                if(!folderStat.isDirectory()) {
                    throw (new Exception(retCode.INVALID_INPUT, 'Sorry, ' + lgFolder + ' is not a folder or does not exist'));
                }
            } catch (err) {
                throw (new Exception(retCode.INVALID_INPUT, 'Sorry, ' + lgFolder + ' is not a folder or does not exist'));
            }
            
            // get files from folder
            lgFiles = parserHelper.findFiles(lgFolder, includeSubFolder, lgFileExt);
        }
        
        if(lgFiles && lgFiles.length === 0) {
            throw (new Exception(retCode.INVALID_INPUT, 'No .lg files specified or none found in specified folder'));
        }
        // loop through lgFiles, parse each one
        while(lgFiles.length > 0) {
            let file = lgFiles[0];
            let fileContent, localizedContent; 
            try {
                fileContent = parserHelper.getFileContent(file);
                if(verbose) process.stdout.write(chalk.default.whiteBright('Translating file: ' + file + '\n'));
                localizedContent = await this.translateFile(fileContent, toLang, translateKey, srcLang, translateComments, translateLinkText, verbose);
                // write out file content
                let lgOutFileAndFolder = await getOutputFileNameAndFolder(file, outputFileName, lOutputFolder, toLang);
                await parserHelper.writeToDisk(localizedContent, lgOutFileAndFolder.lgFileName, lgOutFileAndFolder.lOutputFolder, verbose);
                lgFiles.splice(0,1);
            } catch (err) {
                throw (err);
            }
        }
    }, 
    /**
     * Async function to localize .lg file content
     * 
     * @param {string} inputFileContent file content to localize
     * @param {string} toLang target langauge to localize content to
     * @param {string} translateKey Microsoft text translation API translation key
     * @param {string} srcLang Source content language
     * @param {boolean} translateComments If true, comments in .lg files will be localized
     * @param {boolean} translateLinkText If true, link description text for .lg files will be localized
     * @param {boolean} log If true, write verbose log messages to console.log
     * @returns {string} Translated content
     * @throws {Exception} Throws on errors. Exception object includes errCode and text. 
     */
    translateFile: async function(inputFileContent, toLang, translateKey, srcLang, translateComments, translateLinkText, log) {
        let linesInFile = inputFileContent.split(/\n|\r\n/);
        let localizedContent = '';
        let data = '';
        let lText = '';
        const NEWLINE = '\r\n';
        const NL = '\n';
        for(lineIndex in linesInFile) {
            let currentLine = linesInFile[lineIndex].trim();
            if(currentLine.indexOf(parserConsts.COMMENT) === 0) {
                if(translateComments) {
                    data = await this.translateText(currentLine, toLang, translateKey, srcLang);
                    localizedContent += data[0].translations[0].text + NEWLINE;
                    if(log) 
                        process.stdout.write(chalk.default.gray(data[0].translations[0].text + NL));
                } else {
                    localizedContent += currentLine + NEWLINE;
                    if(log) 
                        process.stdout.write(chalk.default.gray(currentLine + NL));
                }
            } else if(currentLine.indexOf(parserConsts.FILEREF) === 0) {
                if(translateLinkText) {
                    const linkValueRegEx = new RegExp(/\(.*?\)/g);
                    let linkValueList = currentLine.trim().match(linkValueRegEx);
                    let linkValue = linkValueList[0].replace('(','').replace(')','');
                    const linkTextRegEx = new RegExp(/\[.*\]/g);
                    let linkTextList = currentLine.trim().match(linkTextRegEx);
                    let linkTextValue = linkTextList[0].replace('[','').replace(']','');

                    data = await this.translateText(linkTextValue, toLang, translateKey, srcLang);
                    lText = data[0].translations[0].text;
                    localizedContent += '[' + lText + ']' + '(' + linkValue + ')' + NEWLINE;
                    if(log) 
                        process.stdout.write(chalk.default.gray('[' + lText + ']' + '(' + linkValue + ')' + NL));
                } else {
                    localizedContent += currentLine + NEWLINE;
                    if(log) 
                        process.stdout.write(chalk.default.gray(currentLine + NL));
                }
            } else if(currentLine.indexOf(parserConsts.ENTITY) === 0) {
                // we would not localize entity line 
                localizedContent += currentLine + NEWLINE;
                if(log) 
                    process.stdout.write(chalk.default.gray(currentLine + NL));
            } else if(currentLine.indexOf(parserConsts.INTENT) === 0) {
                // we would not localize intent name but remember we are under intent section
                currentSectionType = parserConsts.INTENT;
                localizedContent += currentLine + NEWLINE;
                if(log) 
                    process.stdout.write(chalk.default.gray(currentLine + NL));
            } else if(currentLine.indexOf('-') === 0 || 
                      currentLine.indexOf('*') === 0 || 
                      currentLine.indexOf('+') === 0 ) {
                // get the list separator
                let listSeparator = currentLine.charAt(0);
                // strip line of the list separator
                let content = currentLine.slice(1).trim();
                // if this is a condition, do not localize this line
                if((content.indexOf(parserConsts.CONDITION) === 0) || (content.indexOf(parserConsts.DEFAULT) === 0)) {
                    localizedContent += currentLine + NEWLINE;
                    if(log) process.stdout.write(chalk.default.gray(currentLine + NL));
                } else {
                    data = await this.translateText(content, toLang, translateKey, srcLang);
                    localizedContent += '\t' + listSeparator + ' ' + data[0].translations[0].text + NEWLINE;
                    if(log) 
                        process.stdout.write(chalk.default.gray(listSeparator + ' ' + data[0].translations[0].text + NL));
                }
            } else if(currentLine === '') {
                localizedContent += NEWLINE;
                if(log) 
                    process.stdout.write(chalk.default.gray(NL));
            } else {
                throw new Exception(retCode.INVALID_INPUT, `Invalid line detected: "${currentLine}"`);
            }
        }
        return localizedContent;
    },
    /**
     * Async function to call Text translate API and localize content
     * 
     * @param {string} content content to localize
     * @param {string} toLang target langauge to localize content to
     * @param {string} translateKey Microsoft text translation API translation key
     * @param {string} srcLang Source content language
     * @returns {void} Nothing
     * @throws {Exception} Throws on errors. Exception object includes errCode and text. 
     */
    translateText: async function(content, toLang, translateKey, srcLang) {
        let tUri = 'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=' + toLang + '&includeAlignment=true';
        if(srcLang) tUri += '&from=' + srcLang;
        const options = {
            method: 'POST',
            body: JSON.stringify ([{'Text' : content}]),
            headers: {
            'Content-Type': 'application/json',
            'Ocp-Apim-Subscription-Key' : translateKey,
            'X-ClientTraceId' : get_guid (),
            }
        };
        const res = await fetch(tUri, options);
        if (!res.ok) {
            throw new Exception(retCode.TRANSLATE_SERVICE_FAIL,`Text translator service call failed with [${res.status}] : ${res.statusText}.\nPlease check key & language code validity`);
        }
        let data = await res.json();
        return data;
    }
};

module.exports = translate;

/**
 * Helper function to create a random guid
  * @returns {string} GUID
 */
const get_guid = function () {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
};
/**
 * Async helper function to construct output file name and folder path
 * @param {string} inputFileName input file name currently being parsed
 * @param {string} outputFileName output file name
 * @param {string} lOutputFolder output folder path
 * @param {string} toLang Target language to translate to
 * @returns {object} object.lgFileName contains the output file name and object.lOutputFolder contains the output folder path
 * @throws {Exception} Throws on errors. Exception object includes errCode and text. 
 */
const getOutputFileNameAndFolder = async function(inputFileName, outputFileName, lOutputFolder, toLang) {
    let fileName = path.basename(inputFileName);
    if(outputFileName) {
        // append input file name to it
        if(outputFileName.indexOf(lgFileExt) !== 0) {
            outputFileName = outputFileName + '_' + fileName.substring(0, fileName.indexOf(lgFileExt)) + lgFileExt;
        } else {
            outputFileName = outputFileName.substring(0, outputFileName.indexOf(lgFileExt)) + '_' + fileName.substring(0, fileName.indexOf(lgFileExt)) + lgFileExt;
        }
    } else {
        outputFileName = fileName;
    }

    if(lOutputFolder) {
        lOutputFolder = path.join(lOutputFolder, toLang);
    } else {
        lOutputFolder = path.join(path.dirname(inputFileName), toLang);
    }
    return {
        'lgFileName': outputFileName,
        'lOutputFolder': lOutputFolder
    }
}