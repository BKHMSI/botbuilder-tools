/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

const LGTemplate = require('./LGTemplate');
const LGEntity = require('./LGEntity');
const LGParsedObj = require('./LGParsedObj');
const LGConditionalResponseTemplate = require('./LGConditionalResponse');

const helpers = require('../utils/helpers');
const validators = require('../utils/validation');
const Exception = require('../utils/exception')

const errCode = require('../enums/errorCodes');
const parserConsts = require('../enums/parserconsts');

class LGObject {
    /**
     * @property {LGTemplate []} LGTemplates
     */
    /**
     * @property {entity []} entities
     */
    constructor(LGTemplates = [], entities = []) {
        this.LGTemplates = LGTemplates?LGTemplates:[];
        this.entities = entities?entities:[];
    }
};

LGObject.fromJSON = function(source) {
    if (!source) {
        return null;
    }
    if (Array.isArray(source)) {
        return source.map(LGObject.fromJSON);
    }
    source.LGTemplates = source.LGTemplates || undefined;
    source.entities = source.entities || undefined;
    const {LGTemplates, entities} = source;
    return new LGObject(LGTemplates, entities);
};

LGObject.toLG = function (parsedFileContent) {
    let retParserObj = new LGParsedObj();
    if(!parsedFileContent) return retParserObj;
    if(!(parsedFileContent instanceof Array)) return retParserObj;
    if(parsedFileContent.length === 0) return retParserObj;
    retParserObj.LGObject = new LGObject();
    parsedFileContent.forEach(function(chunk) {
        let cLGTemplate;
        let pushAtEnd = true;
        chunk = chunk.trim();
        let chunkSplitByLine = chunk.split(/\r\n|\r|\n/g);
        if(chunk.indexOf(parserConsts.INTENT) === 0) {
            let templateName = chunkSplitByLine[0].substring(chunkSplitByLine[0].indexOf(' ') + 1);
            let conditionalResponseItem = null;
            chunkSplitByLine.splice(0,1);
            // see if this template already exists
            if(retParserObj.LGObject.LGTemplates.length > 0) {
                let existingLGTemplate = retParserObj.LGObject.LGTemplates.filter(function(item) {
                    return item.name === templateName;
                });
                if(existingLGTemplate.length !== 0) {
                    pushAtEnd = false;
                    cLGTemplate = existingLGTemplate[0];
                } else {
                    // validate template name when creating a new template item
                    cLGTemplate = new LGTemplate(templateName, null, null);
                    pushAtEnd = true;
                }
            } 
            if(!cLGTemplate || !cLGTemplate.name || cLGTemplate.name === '') { 
                // validate template name when creating a new template item
                cLGTemplate = new LGTemplate(templateName, null, null);
 
            }
            // for the remaining sections, add the content to the cLGTemplate
            let inConditionalResponses = false;
            chunkSplitByLine.forEach(function(item) {
                // cleanup template link references
                item = removeTemplateLinkReferences(item);
                // get entities in the line.
                let entitesInItem = helpers.parseEntity(item);
                if(entitesInItem.entities.length !== 0) {
                    entitesInItem.entities.forEach(item => {
                        if(retParserObj.LGObject.entities.filter(eItem => eItem.name === item).length === 0) 
                            retParserObj.LGObject.entities.push(new LGEntity(item));
                    });
                }
                // remove the list decoration from line.
                if((item.indexOf('-') !== 0) &&
                (item.indexOf('*') !== 0) && 
                (item.indexOf('+') !== 0)) {
                    throw ({
                        errCode: errCode.NO_LIST_DECORATION_ON_VARIATION, 
                        text: 'Template item: "' + item + '" does not have list decoration. Prefix line with "-" or "+" or "*"'
                    });
                }
                item = item.slice(1).trim();
                
                if(item.trim().indexOf(parserConsts.CONDITION) === 0) {
                    if(inConditionalResponses && pushAtEnd) {
                        cLGTemplate.conditionalResponses.push(conditionalResponseItem);
                    }
                    // see if we already have this condition if so, get that object
                    let condition = item.replace(parserConsts.CONDITION, '').trim();
                    if(cLGTemplate.conditionalResponses.length > 0) {
                        let haveThisCondition = cLGTemplate.conditionalResponses.filter(item => {return item.condition == condition;});
                        if(haveThisCondition.length > 0) {
                            conditionalResponseItem = haveThisCondition[0];
                            pushAtEnd = false;
                        } else {
                            // validate condition 
                            validators.validateCondition(condition, true);
                            conditionalResponseItem = new LGConditionalResponseTemplate(condition);
                            pushAtEnd = true;
                        }
                    } else {
                        // validate condition 
                        validators.validateCondition(condition, true);
                        conditionalResponseItem = new LGConditionalResponseTemplate(condition);
                        pushAtEnd = true;
                    }
                    inConditionalResponses = true;
                } else if(item.trim().indexOf(parserConsts.DEFAULT) === 0) {
                    if(inConditionalResponses && pushAtEnd) {
                        cLGTemplate.conditionalResponses.push(conditionalResponseItem);
                    }
                    // see if we already have this condition if so, get that object
                    let condition = item.replace(parserConsts.DEFAULT, parserConsts.ELSE).trim();
                    if(cLGTemplate.conditionalResponses.length > 0) {
                        let haveThisCondition = cLGTemplate.conditionalResponses.filter(item => item.condition === condition);
                        if(haveThisCondition.length > 0) {
                            conditionalResponseItem = haveThisCondition[0];
                            pushAtEnd = false;
                        } else {
                            // validate condition 
                            validators.validateCondition(condition, false);
                            conditionalResponseItem = new LGConditionalResponseTemplate(condition, []);
                            pushAtEnd = true;
                        }
                    } else {
                        // validate condition 
                        validators.validateCondition(condition, false);
                        conditionalResponseItem = new LGConditionalResponseTemplate(condition);
                        pushAtEnd = true;
                    }
                    inConditionalResponses = true;
                } else {
                    if(inConditionalResponses) {
                        // validate variation
                        if(validators.validateVariationItem(item) && !conditionalResponseItem.variations.includes(item)) 
                            conditionalResponseItem.variations.push(item);
                    } else {
                        // validate variation
                        if(validators.validateVariationItem(item) && !cLGTemplate.variations.includes(item)) 
                            cLGTemplate.variations.push(item);
                    }
                }
            });
            if(inConditionalResponses && pushAtEnd) 
                cLGTemplate.conditionalResponses.push(conditionalResponseItem);
            if(cLGTemplate.name !== '' && pushAtEnd) 
                retParserObj.LGObject.LGTemplates.push(cLGTemplate);
            if(cLGTemplate.variations.length === 0 && cLGTemplate.conditionalResponses.length === 0) {
                throw new Exception(errCode.INVALID_TEMPLATE, 'Template "' + cLGTemplate.name + '" does not have any variations or conditional response definition');
            }
        } else if(chunk.indexOf(parserConsts.FILEREF) === 0) { 
            let linkValueRegEx = new RegExp(/\(.*?\)/g);
            let linkValueList = chunkSplitByLine[0].trim().match(linkValueRegEx);
            let linkValue = linkValueList[0].replace('(','').replace(')','');
            if(linkValue === '') {
                throw(new Exception(errCode.INVALID_LG_FILE_REF, '[ERROR]: ' + 'Invalid LU File Ref: ' + chunkSplitByLine[0]));
            }
            retParserObj.additionalFilesToParse.push(linkValue);
        } else if(chunk.indexOf(parserConsts.ENTITY) === 0) {
            let entityDef = chunkSplitByLine[0].replace(parserConsts.ENTITY, '').split(':');
            if(entityDef.length !== 2) 
                throw new Exception(errCode.INVALID_ENTITY_DEFINITION, 'Invalid entity definition for "' + chunkSplitByLine[0] + '"');
            let entityName = entityDef[0].trim();
            let entityTypeAndAttributes = entityDef[1].trim().split(' ');
            let entityType = entityTypeAndAttributes[0].trim();
            let entityAttributes = [];
            if(entityTypeAndAttributes.length != 1) {
                for(i = 1; i < entityTypeAndAttributes.length; i+=3) {
                    entityAttributes.push({'key': entityTypeAndAttributes[i], 'value': entityTypeAndAttributes[i+2]});
                }
            }
            let newEntity = new LGEntity(entityName, entityType, entityAttributes);
            // see if this entity already exists
            let entityInCollection = retParserObj.LGObject.entities.filter(item => item.name === entityName);
            if(entityInCollection.length !== 0) {
                entityInCollection[0].entityType = LGEntity.getEntityType(entityType);
            } else {
                retParserObj.LGObject.entities.push(newEntity);
            }
        } else {
            throw new Exception(errCode.INVALID_INPUT, 'Unidentified template definition. Template definition must start with # <Template Name> :: \n' + chunk);
        }
        
    });
    return retParserObj;
}

module.exports = LGObject;

const removeTemplateLinkReferences = function(item) {
    let itemsSplitByTemplateRef = item.split(/\]\((.*?)\)/g);
    let retItem = '';
    if(itemsSplitByTemplateRef.length === 1) return item;
    for(i = 0; i < itemsSplitByTemplateRef.length - 1; i+=2) {
        retItem += itemsSplitByTemplateRef[i] + ']';
    }
    return retItem;
}
