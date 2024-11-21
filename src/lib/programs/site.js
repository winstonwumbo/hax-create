#!/usr/bin/env node
import { setTimeout } from 'node:timers/promises';
import * as fs from 'node:fs';

import * as p from '@clack/prompts';
import color from 'picocolors';
import { dump, load } from 'js-yaml';

import { parse } from 'node-html-parser';
import { merlinSays, communityStatement, log } from "../statements.js";

// trick MFR into giving local paths
globalThis.MicroFrontendRegistryConfig = {
  base: `@haxtheweb/open-apis/`
};
import { MicroFrontendRegistry } from "../micro-frontend-registry.js";
// emable HAXcms routes so we have name => path just like on frontend!
MicroFrontendRegistry.enableServices(['core', 'haxcms', 'experimental']);

import * as haxcmsNodejsCli from "@haxtheweb/haxcms-nodejs/dist/cli.js";
import * as hax from "@haxtheweb/haxcms-nodejs";
import * as josfile from "@haxtheweb/haxcms-nodejs/dist/lib/JSONOutlineSchema.js";
const JSONOutlineSchema = josfile.default;
const HAXCMS = hax.HAXCMS;
import * as child_process from "child_process";
import * as util from "node:util";
const exec = util.promisify(child_process.exec);
var sysSurge = true;
exec('surge --version', error => {
  if (error) {
    sysSurge = false;
  }
});

// fake response class so we can capture the response from the headless route as opposed to print to console
// this way we can handle as data or if use is requesting output format to change we can respond
class Res {
  constructor() {
    this.query = {};
    this.data = null;
    this.statusCode = null;
  }
  send(data) {
    this.data = data;
    return this;
  }
  status(status) {
    this.statusCode = status;
    return this;
  }
  json(data) {
    this.data = JSON.parse(JSON.stringify(data));
    return this;
  }
  setHeader() {
    return this;
  }
}


export function siteActions() {
  return [
    { value: 'start', label: "Launch site in browser (http://localhost)"},
    { value: 'node:stats', label: "Node Stats / data"},
    { value: 'node:add', label: "Add a new page"},
    { value: 'node:edit', label: "Edit a page"},
    { value: 'node:delete', label: "Delete a page"},
    { value: 'site:stats', label: "Site Status / stats" },
    { value: 'site:items', label: "Site items" },
    { value: 'site:items-import', label: "Import items (JOS / site.json)" },
    { value: 'site:list-files', label: "List site files" },
    { value: 'site:theme', label: "Change theme"},
    { value: 'site:html', label: "Full site as HTML"},
    { value: 'site:md', label: "Full site as Markdown"},
    { value: 'site:schema', label: "Full site as HAXElementSchema"},
    { value: 'site:sync', label: "Sync git repo"},
  ];
}

export async function siteCommandDetected(commandRun) {
    var activeHaxsite = await hax.systemStructureContext();
    // default to status unless already set so we don't issue a create in a create
    if (!commandRun.arguments.action) {
        commandRun.arguments.action = 'status';
      }
      commandRun.command = "site";
      if (!commandRun.options.y && commandRun.options.i && !commandRun.options.quiet) {
        p.intro(`${color.bgBlack(color.white(` HAXTheWeb : Site detected `))}`);
        p.intro(`${color.bgBlue(color.white(` Name: ${activeHaxsite.name} `))}`);  
      }
      // defaults if nothing set via CLI
      let operation = {
        ...commandRun.arguments,
        ...commandRun.options
      };
      if (!commandRun.options.title) {
        commandRun.options.title = "New Page";
      }
      if (!commandRun.options.domain &&  commandRun.options.y) {
        commandRun.options.domain = `haxcli-${activeHaxsite.name}.surge.sh`;
      }
      // infinite loop until quitting the cli
      while (operation.action !== 'quit') {
        let actions = siteActions();
        if (sysSurge) {
          actions.push({ value: 'site:surge', label: "Publish site to Surge.sh"});              
        }
        actions.push({ value: 'quit', label: "🚪 Quit"});
        if (!operation.action) {
          commandRun = {
            command: null,
            arguments: {},
            options: {}
          }
          // ensures data is updated and stateful per action
          activeHaxsite = await hax.systemStructureContext();
          operation = await p.group(
            {
              action: ({ results }) =>
                p.select({
                  message: `Actions you can take`,
                  options: actions,
                }),
            },
            {
              onCancel: () => {
                if (!commandRun.options.quiet) {
                  p.cancel('🧙 Merlin: Canceling CLI.. HAX ya later 🪄');
                  communityStatement();
                }
                process.exit(0);
              },
            });
        }
        switch (operation.action) {
          case "site:stats":
            const date = new Date(activeHaxsite.manifest.metadata.site.updated*1000);
            let siteItems = [];
            if (commandRun.options.itemId != null) {
              siteItems = activeHaxsite.manifest.findBranch(commandRun.options.itemId);
            }
            else {
              siteItems = activeHaxsite.manifest.orderTree(activeHaxsite.manifest.items);
            }
            let els = {};
            for (var i in siteItems) {
              let page = activeHaxsite.loadNode(siteItems[i].id);
              let html = await activeHaxsite.getPageContent(page);
              let dom = parse(`<div id="fullpage">${html}</div>`);
              for (var j in dom.querySelector('#fullpage').childNodes) {
                let node = dom.querySelector('#fullpage').childNodes[j];
                if (node && node.getAttribute) {
                  let haxel = await nodeToHaxElement(node, null);
                  if (!els[haxel.tag]) {
                    els[haxel.tag] = 0;
                  }
                  els[haxel.tag]++;
                }
              }
            }
            let siteStats = {
              title: activeHaxsite.manifest.title,
              description: activeHaxsite.manifest.description,
              themeName: activeHaxsite.manifest.metadata.theme.name,
              themeElement: activeHaxsite.manifest.metadata.theme.element,
              pageCount: activeHaxsite.manifest.items.length,
              lastUpdated: date.toLocaleDateString("en-US"),
              tagUsage: els
            }
            if (!commandRun.options.format && !commandRun.options.quiet) {
              p.intro(`${color.bgBlue(color.white(` Title: ${siteStats.title} `))}`);
              p.intro(`${color.bgBlue(color.white(` Description: ${siteStats.description} `))}`);
              p.intro(`${color.bgBlue(color.white(` Theme: ${siteStats.themeName} (${siteStats.themeElement})`))}`);
              p.intro(`${color.bgBlue(color.white(` Pages: ${siteStats.pageCount} `))}`);  
              p.intro(`${color.bgBlue(color.white(` Last updated: ${siteStats.lastUpdated} `))}`);
              p.intro(`${color.bgBlue(color.white(` Tags used: ${JSON.stringify(siteStats.tagUsage, null, 2)} `))}`);
            }
            else if (commandRun.options.format === 'yaml') {
              log(dump(siteStats));
            }
            else {
              log(siteStats);
            }
            // simple redirecting to file
            if (commandRun.options.toFile) {
              if (commandRun.options.format === 'yaml') {
                fs.writeFileSync(commandRun.options.toFile, dump(siteStats))
              }
              else {
                fs.writeFileSync(commandRun.options.toFile, JSON.stringify(siteStats, null, 2))
              }
            }
          break;
          case "site:items":
            let siteitems = [];
            if (commandRun.options.itemId != null) {
              siteitems = activeHaxsite.manifest.findBranch(commandRun.options.itemId);
            }
            else {
              siteitems = activeHaxsite.manifest.orderTree(activeHaxsite.manifest.items);
            }
            for (let i in siteitems) {
              let page = await activeHaxsite.loadNode(siteitems[i].id);
              siteitems[i].content = await activeHaxsite.getPageContent(page);
            }
            // simple redirecting to file if asked for
            if (commandRun.options.toFile) {
              let contents = '';
              if (commandRun.options.format === 'yaml') {
                contents = dump(siteitems);
              }
              else {
                contents = JSON.stringify(siteitems, null, 2);
              }
              fs.writeFileSync(commandRun.options.toFile, contents);
              
            }
            else {
              if (commandRun.options.format === 'yaml') {
                log(dump(siteitems));
              }
              else {
                log(siteitems);
              }
            }
          break;
          case "site:items-import":
            // need source, then resolve what it is
            if (commandRun.options.itemsImport) {
              let location = commandRun.options.itemsImport;
              let josImport = new JSONOutlineSchema();
              var itemsImport = [];
              // support for address, as in import from some place else
              if (location.startsWith('https://') || location.startsWith('http://')) {
                if (location.endsWith('/site.json')) {
                  location = location.replace('/site.json','');
                }
                else if (!location.endsWith('/')) {
                  location = location + '/';
                }
                let f = await fetch(`${location}site.json`).then(d => d.ok ? d.json() : null);
                if (f && f.items) {
                  josImport.items = f.items;
                }
                else {
                  // invalid data
                  process.exit(0);
                }
              }
              // look on prem
              else if(fs.existsSync(location)) {
                let fileContents = await fs.readFileSync(location);
                if (location.endsWith('.json')) {
                  josImport.items = JSON.parse(fileContents);

                }
                else if (location.endsWith('.yaml')) {
                  josImport.items = await load(fileContents);
                }
              }
              // allows for filtering
              if (commandRun.options.itemId) {
                itemsImport = josImport.findBranch(commandRun.options.itemId);
              }
              else {
                itemsImport = josImport.items;
              }
              for (let i in josImport.items) {
                if (josImport.items[i].location && !josImport.items[i].content) {
                  josImport.items[i].content = await fetch(`${location}${josImport.items[i].location}`).then(d => d.ok ? d.text() : '');
                }
              }
              let itemIdMap = {};
              for (let i in josImport.items) {
                // if we have a parent set by force to append this structure to
                // then see if parent = null (implying top level in full site import)
                // or match on itemId to imply that it's the top (no matter parent status)
                if (commandRun.options.parentId) {
                  if (josImport.items[i].parent === null || josImport.items[i].id === commandRun.options.itemId) {
                    josImport.items[i].parent = commandRun.options.parentId;
                  }
                }
                // see if map has an entry that is already set
                if (itemIdMap[josImport.items[i].parent]) {
                  // remaps the parent of this item bc the thing imported has changed ID
                  josImport.items[i].parent = itemIdMap[josImport.items[i].parent];
                }
                let tmpAddedItem = await activeHaxsite.addPage(
                  josImport.items[i].parent,
                  josImport.items[i].title,
                  'html',
                  josImport.items[i].slug,
                  null,
                  josImport.items[i].indent,
                  josImport.items[i].content,
                  josImport.items[i].order,
                  josImport.items[i].metadata
                );
                // set in the map for future translations
                itemIdMap[josImport.items[i].id] = tmpAddedItem.id;
              }
              if (!commandRun.options.quiet) {
                log(`${josImport.items.length} nodes imported`);
              }
            }
            else if (!commandRun.options.quiet) {
              log('Must specify --item-import as path to valid item export file or URL', 'error');
            }
          break;
          case "start":
            try {
              if (!commandRun.options.quiet) {
                p.intro(`Starting server.. `);
                p.intro(`⌨️  To stop server, press: ${color.bold(color.black(color.bgRed(` CTRL + C `)))}`);  
              }
              await exec(`cd ${activeHaxsite.directory} && npx @haxtheweb/haxcms-nodejs`);
            }
            catch(e) {
              log(e.stderr);
            }
          break;
          case "node:stats":
            try {
              if (!commandRun.options.itemId) {
                commandRun.options.itemId = await p.select({
                  message: `Select an item to edit`,
                  required: true,
                  options: [ {value: null, label: "-- edit nothing, exit --" }, ...await siteItemsOptionsList(activeHaxsite)],
                });
              }
              if (commandRun.options.itemId) {
                let nodeOps = siteNodeStatsOperations();
                let page = activeHaxsite.loadNode(commandRun.options.itemId);
                // select which aspect of this we are editing
                if (!commandRun.options.nodeOp) {
                  commandRun.options.nodeOp = await p.select({
                    message: `${page.title} (${page.id}) - Node operations`,
                    required: true,
                    options: [ {value: null, label: "-- Exit --"}, ...nodeOps],
                  });
                }
                if (commandRun.options.nodeOp && siteNodeStatsOperations(commandRun.options.nodeOp)) {
                  switch(commandRun.options.nodeOp) {
                    case 'details':
                      if (commandRun.options.format === 'yaml') {
                        log(dump(page));
                      }
                      else {
                        log(page);
                      }
                      // simple redirecting to file
                      if (commandRun.options.toFile) {
                        if (commandRun.options.format === 'yaml') {
                          fs.writeFileSync(commandRun.options.toFile, dump(page))
                        }
                        else {
                          fs.writeFileSync(commandRun.options.toFile, JSON.stringify(page, null, 2))
                        }
                      }
                    break;
                    case 'html':
                      let itemHTML = await activeHaxsite.getPageContent(page);
                      // simple redirecting to file
                      if (commandRun.options.toFile) {
                        fs.writeFileSync(commandRun.options.toFile, itemHTML)
                      }
                      else {
                        log(itemHTML);
                      }
                    break;
                    case 'schema':
                      // next up
                      let html = await activeHaxsite.getPageContent(page);
                      let dom = parse(`<div id="fullpage">${html}</div>`);
                      let els = [];
                      for (var i in dom.querySelector('#fullpage').childNodes) {
                        let node = dom.querySelector('#fullpage').childNodes[i];
                        if (node && node.getAttribute) {
                          els.push(await nodeToHaxElement(node, null));
                        }
                      }
                      // simple redirecting to file
                      if (commandRun.options.toFile) {
                        if (commandRun.options.format === 'yaml') {
                          fs.writeFileSync(commandRun.options.toFile, dump(els))
                        }
                        else {
                          fs.writeFileSync(commandRun.options.toFile, JSON.stringify(els, null, 2))
                        }
                      }
                      else {
                        if (commandRun.options.format === 'yaml') {
                          log(dump(els));
                        }
                        else {
                          log(els);
                        }
                      }
                    break;
                    case 'md':
                    let resp = await openApiBroker('@core', 'htmlToMd', { html: await activeHaxsite.getPageContent(page)})
                    // simple redirecting to file
                    if (commandRun.options.toFile) {
                      fs.writeFileSync(commandRun.options.toFile, resp.res.data.data);
                    }
                    else {
                      log(resp.res.data.data);
                    }
                    break;
                  }
                }
              }
            }
            catch(e) {
              log(e.stderr);
              log(e);
            }
          break;
          case "node:add":
            try {
              if (!commandRun.options.title) {
                commandRun.options.title = await p.text({
                  message: `Title for this page`,
                  placeholder: "New page",
                  required: true,
                  validate: (value) => {
                    if (!value) {
                      return "Title must be set (tab writes default)";
                    }
                  }
                });
              }
              var createNodeBody = { 
                site: activeHaxsite,
                node: { 
                  title: commandRun.options.title
                }
              };
              // this would be odd but could be direct with no format specified
              if (commandRun.options.content && !commandRun.options.format) {
                // only API where it's called contents and already out there {facepalm}
                // but user already has commands where it's --content as arg
                createNodeBody.node.contents = commandRun.options.content;
              }
              else if (commandRun.options.content && commandRun.options.format) {
                // @todo support for md,html,schema both local and remote resolution

                // if we have format set, then  we need to interpret content as a url
                let location = commandRun.options.content;
                let locationContent = '';
                // support for address, as in import from some place else
                if (location.startsWith('https://') || location.startsWith('http://')) {                  
                  locationContent = await fetch(location).then(d => d.ok ? d.text() : '');
                }
                // look on prem
                else if(fs.existsSync(location)) {
                  locationContent = await fs.readFileSync(location);
                  if (location.endsWith('.json')) {
                    locationContent = JSON.parse(locationContent);
                  }
                  else if (location.endsWith('.yaml')) {
                    locationContent = await load(locationContent);
                  }
                  else if (location.endsWith('.md')) {
                    let resp = await openApiBroker('@core', 'mdToHtml', { md: locationContent, raw: true});
                    console.log(resp);
                    if (resp.res.data) {
                      locationContent = resp.res.data;
                    }
                  }
                }
                // support for scraper mode to find title from the content responsee
                if (commandRun.options.titleScrape) {
                  let dom = parse(`${locationContent}`);
                  createNodeBody.node.title = dom.querySelector(`${commandRun.options.titleScrape}`).textContent;
                }
                // support scraper mode which targets a wrapper for the actual content
                if (commandRun.options.contentScrape) {
                  let dom = parse(`${locationContent}`);
                  locationContent = dom.querySelector(`${commandRun.options.contentScrape}`).innerHTML;
                }
                createNodeBody.node.contents = locationContent;
              }
              let resp = await haxcmsNodejsCli.cliBridge('createNode', createNodeBody);
              if (commandRun.options.v) {
                log(resp.res.data);
              }
              if (!commandRun.options.quiet) {
                log(`"${createNodeBody.node.title}" added to site`);
              }
            }
            catch(e) {
              log(e.stderr);
            }
          break;
          case "node:edit":
            try {
              if (!commandRun.options.itemId) {
                commandRun.options.itemId = await p.select({
                  message: `Select an item to edit`,
                  required: true,
                  options: [ {value: null, label: "-- edit nothing, exit --" }, ...await siteItemsOptionsList(activeHaxsite)],
                });
              }
              if (commandRun.options.itemId) {
                let nodeOps = siteNodeOperations();
                let page = activeHaxsite.loadNode(commandRun.options.itemId);
                // select which aspect of this we are editing
                if (!commandRun.options.nodeOp) {
                  commandRun.options.nodeOp = await p.select({
                    message: `${page.title} (${page.id}) - Node operations`,
                    required: true,
                    options: [ {value: null, label: "-- Exit --"}, ...nodeOps],
                  });
                }
                if (commandRun.options.nodeOp && siteNodeOperations(commandRun.options.nodeOp)) {
                  let nodeProp = commandRun.options.nodeOp;
                  var propValue = commandRun.options[nodeProp];
                  // verify we have a setting for the operation requested
                  // otherwise we get interactive again
                  if (!commandRun.options[nodeProp]) {
                    let val = page[nodeProp];
                    if (['tags', 'published', 'hideInMenu', 'theme'].includes(nodeProp)) {
                      val = page.metadata[nodeProp];
                    }
                    else if (nodeProp === 'content') {
                      val = await activeHaxsite.getPageContent(page);
                    }
                    //  boolean is confirm
                    if (['published', 'hideInMenu'].includes(nodeProp)) {
                      propValue = await p.confirm({
                        message: `${nodeProp}:`,
                        initialValue: Boolean(val),
                        defaultValue: Boolean(val),
                      });
                    }
                    // these have fixed possible values
                    else if (['parent', 'theme'].includes(nodeProp)) {
                      let l = nodeProp === 'parent' ? "-- no parent --" : "-- no theme --";
                      let list = nodeProp === 'parent' ? await siteItemsOptionsList(activeHaxsite,  page.id) : await siteThemeList();
                      propValue = await p.select({
                        message: `${nodeProp}:`,
                        defaultValue: val,
                        initialValue: val,
                        options: [ {value: null, label: l }, ...list],
                      });
                    }
                    else {
                      propValue = await p.text({
                        message: `${nodeProp}:`,
                        initialValue: val,
                        defaultValue: val,
                      });
                    }
                  }
                  if (nodeProp === 'order') {
                    propValue = parseInt(propValue);
                  }
                  // account for CLI
                  if (propValue === "null") {
                    propValue = null;
                  }
                  commandRun.options[nodeProp] = propValue;
                }
                // ensure we set empty values, just not completely undefined values
                if (typeof commandRun.options[commandRun.options.nodeOp] !== "undefined") {
                  if (commandRun.options.nodeOp === 'content') {
                    let locationContent = '';
                    // this would be odd but could be direct with no format specified
                    if (commandRun.options.content && !commandRun.options.format) {
                      locationContent = commandRun.options.content;
                    }
                    // this implies what we were given needs processing as a file / url
                    else if (commandRun.options.content && commandRun.options.format) {
                      // if we have format set, then  we need to interpret content as a url
                      let location = commandRun.options.content;
                      // support for address, as in import from some place else
                      if (location.startsWith('https://') || location.startsWith('http://')) {                  
                        locationContent = await fetch(location).then(d => d.ok ? d.text() : '');
                      }
                      // look on prem
                      else if(fs.existsSync(location)) {
                        locationContent = await fs.readFileSync(location);
                        if (location.endsWith('.json')) {
                          locationContent = JSON.parse(locationContent);
                        }
                        else if (location.endsWith('.yaml')) {
                          locationContent = await load(locationContent);
                        }
                        else if (location.endsWith('.md')) {
                          let resp = await openApiBroker('@core', 'mdToHtml', { md: locationContent, raw: true});
                          console.log(resp);
                          if (resp.res.data) {
                            locationContent = resp.res.data;
                          }
                        }
                      }
                      // support scraper mode which targets a wrapper for the actual content
                      if (commandRun.options.contentScrape) {
                        let dom = parse(`${locationContent}`);
                        locationContent = dom.querySelector(`${commandRun.options.contentScrape}`).innerHTML;
                      }
                    }
                    // if we have content (meaning it's not blank) then try to write the page location                    
                    if (locationContent && await page.writeLocation(locationContent)) {
                      if (!commandRun.options.quiet) {
                        log(`node:edit success updated page content: "${page.id}`);
                      }
                    }
                    else {
                      console.warn(`node:edit failure to write page content : ${page.id}`);
                    }
                  }
                  else {
                    if (['tags', 'published', 'hideInMenu'].includes(commandRun.options.nodeOp)) {
                      page.metadata[commandRun.options.nodeOp] = commandRun.options[commandRun.options.nodeOp];
                    }
                    else if (commandRun.options.nodeOp === 'theme') {
                      let themes = await HAXCMS.getThemes();
                      page.metadata.theme = themes[commandRun.options[commandRun.options.nodeOp]];
                    }
                    else {
                      page[commandRun.options.nodeOp] = commandRun.options[commandRun.options.nodeOp];
                    }
                    let resp = await activeHaxsite.updateNode(page);
                    if (commandRun.options.v) {
                      log(resp);
                    }
                  }
                }
              }
            }
            catch(e) {
              log(e.stderr);
            }
          break;
          case "node:delete":
            try {
              if (!commandRun.options.itemId) {
                commandRun.options.itemId = await p.select({
                  message: `Select an item to delete`,
                  required: true,
                  options: [ {value: null, label: "-- Delete nothing, exit --" }, ...await siteItemsOptionsList(activeHaxsite)],
                });
              }
              if (commandRun.options.itemId) {
                let del = false;
                if (!commandRun.options.y) {
                  del = await p.confirm({
                    message: `Are you sure you want to delete ${commandRun.options.itemId}? (This cannot be undone)`,
                    initialValue: true,
                  });
                }
                else {
                  del = true;
                }
                // extra confirmation given destructive operation
                if (del) {
                  let resp = await haxcmsNodejsCli.cliBridge('deleteNode', { site: activeHaxsite, node: { id: commandRun.options.itemId }});
                  if (resp.res.data === 500) {
                    console.warn(`node:delete failed "${commandRun.options.itemId} not found`);
                  }
                  else {
                    log(`"${commandRun.options.itemId}" deleted`);
                  }    
                }
                else {
                  log(`Delete operation canceled`);
                }
              }
            }
            catch(e) {
              log(e.stderr);
            }
          break;
          case "site:sync":
            // @todo git sync might need other arguments / be combined with publishing
            try {
              await exec(`cd ${activeHaxsite.directory} && git pull && git push`);
            }
            catch(e) {
              log(e.stderr);
            }
          break;
          case "site:theme":
            try {
              //theme
              let list = await siteThemeList();
              activeHaxsite = await hax.systemStructureContext();
              let val = activeHaxsite.manifest.metadata.theme.element;
              if (!commandRun.options.theme) {
                commandRun.options.theme = await p.select({
                  message: `Select theme:`,
                  defaultValue: val,
                  initialValue: val,
                  options: list,
                });
                let themes = await HAXCMS.getThemes();
                if (themes && commandRun.options.theme && themes[commandRun.options.theme]) {
                  activeHaxsite.manifest.metadata.theme = themes[commandRun.options.theme];
                  activeHaxsite.manifest.save(false);
                }
              }
            }
            catch(e) {
              log(e.stderr);
            }
          break;
          case "site:surge":
            try {
              if (!commandRun.options.domain) {
                commandRun.options.domain = await p.text({
                  message: `Domain for surge`,
                  defaultValue: `haxcli-${activeHaxsite.name}.surge.sh`,
                  required: true,
                  validate: (value) => {
                    if (!value) {
                      return "Domain must have a value";
                    }
                  }
                });
              }
              let execOutput = await exec(`cd ${activeHaxsite.directory} && surge . ${commandRun.options.domain}`);
              log(execOutput.stdout.trim());
            }
            catch(e) {
              log(e.stderr);
            }
          break;
          case "site:file-list":
            let res = new Res();
            await hax.RoutesMap.get.listFiles({query: activeHaxsite.name, filename: commandRun.options.filename}, res);
            if (commandRun.options.format === 'yaml') {
              log(dump(res.data));
            }
            else {
              log(res.data);
            }
            break;
          case "site:html":
          case "site:md":
          case "site:schema":
            let siteContent = '';
            activeHaxsite = await hax.systemStructureContext();
            let items = [];
            if (commandRun.options.itemId != null) {
              items = activeHaxsite.manifest.findBranch(commandRun.options.itemId);
            }
            else {
              items = activeHaxsite.manifest.orderTree(activeHaxsite.manifest.items);
            }
            if (operation.action === 'site:schema') {
              let els = [];
              for (var i in items) {
                let page = activeHaxsite.loadNode(items[i].id);
                let html = await activeHaxsite.getPageContent(page);
                let dom = parse(`<div id="fullpage">${html}</div>`);
                els.push({
                  tag: "h1",
                  properties: {
                    "data-jos-item-id": items[i].id
                  },
                  content: `${items[i].title}`
                });
                for (var j in dom.querySelector('#fullpage').childNodes) {
                  let node = dom.querySelector('#fullpage').childNodes[j];
                  if (node && node.getAttribute) {
                    els.push(await nodeToHaxElement(node, null));
                  }
                }
              }
              // simple redirecting to file
              if (commandRun.options.toFile) {
                if (commandRun.options.format === 'yaml') {
                  fs.writeFileSync(commandRun.options.toFile, dump(els))
                }
                else {
                  fs.writeFileSync(commandRun.options.toFile, JSON.stringify(els, null, 2))
                }
              }
              else {
                if (commandRun.options.format === 'yaml') {
                  log(dump(els));
                }
                else {
                  log(els);
                }
              }
            }
            else {
              for (var i in items) {
                let page = activeHaxsite.loadNode(items[i].id); 
                siteContent += `<h1>${items[i].title}</h1>\n\r`;
                siteContent += `<div data-jos-item-id="${items[i].id}">\n\r${await activeHaxsite.getPageContent(page)}\n\r</div>\n\r`;
              }
              if (operation.action === 'site:md') {
                let resp = await openApiBroker('@core', 'htmlToMd', { html: siteContent});
                if (commandRun.options.toFile) {
                  fs.writeFileSync(commandRun.options.toFile, resp.res.data.data);
                  if (!commandRun.options.quiet) {
                    log(`${commandRun.options.toFile} written`);
                  }
                }
                else {
                  log(resp.res.data.data);
                }
              }
              else {
                if (commandRun.options.toFile) {
                  fs.writeFileSync(commandRun.options.toFile, siteContent);
                  if (!commandRun.options.quiet) {
                    log(`${commandRun.options.toFile} written`);
                  }
                }
                else {
                  log(siteContent);
                }
              }
            }
          break;
          case "quit":
          // quit
          process.exit(0);
          break;
        }
        // y or noi need to act like it ran and finish instead of looping options
        if (commandRun.options.y || !commandRun.options.i) {
          process.exit(0);
        }
        operation.action = null;
      }
      if (!commandRun.options.quiet) {
        communityStatement();
      }
}

export function siteNodeStatsOperations(search = null){
  let obj = [
    {value: 'details', label: "Details"},
    {value: 'html', label: "Page as HTML source"},
    {value: 'schema', label: "Page as HAXElementSchema"},
    {value: 'md', label: "Page as Markdown"},    
  ];
  if (search) {
    for (const op of obj) {
      if (op.value === search) {
        return true;
      }
    }
    return false;
  }
  return obj;
}

export function siteNodeOperations(search = null){
  let obj = [
    {value: 'title', label: "Title"},
    {value: 'content', label: "Page content"},
    {value: 'slug', label: "Path (slug)"},
    {value: 'published', label: "Publishing status"},
    {value: 'tags', label: "Tags"},
    {value: 'parent', label: "Parent"},
    {value: 'order', label: "Order"},
    {value: 'theme', label: "Theme"},
    {value: 'hideInMenu', label: "Hide in menu"},
  ];
  if (search) {
    for (const op of obj) {
      if (op.value === search) {
        return true;
      }
    }
    return false;
  }
  return obj;
}

// broker a call to the open-api repo which is an express based wrapper for vercel (originally)
// this ensures the calls are identical and yet are converted to something the CLI can leverage
async function openApiBroker(scope, call, body) {
  let mfItem = MicroFrontendRegistry.get(`${scope}/${call}`);
  // ensure we have a MFR record to do the connection
  // fun thing is this is local file access directly via import()
  if (mfItem) {
    // dynamic import... this might upset some stuff later bc it's not a direct reference
    // but it's working locally at least.
    const handler = await import(`${mfItem.endpoint.replace('/api/', '/dist/')}.js`);
    let res = new Res();
    let req = {
      body: JSON.stringify(body),
      method: "post"
    };
    // js pass by ref for the win; these will both update bc of how we structured the calls
    await handler.default(req, res);
    // they'll need unpacked but that's a small price!
    return {
      req: req,
      res: res
    };
  }
}
// process site creation
export async function siteProcess(commandRun, project, port = '3000') {    // auto select operations to perform if requested
  var s = p.spinner();
  if (!project.extras) {
    project.extras = [];
    if (commandRun.options.i) {
      project.extras = ['launch'];
    }
  }
  if (!commandRun.options.quiet) {
    s.start(merlinSays(`Creating new site: ${project.name}`));
  }
  let siteRequest = {
      "site": {
          "name": project.name,
          "description": "own course",
          "theme": commandRun.options.theme ? commandRun.options.theme : "clean-one"
      },
      "build": {
          "type": "own",
          "structure": "course",
          "items": null,
          "files": null,
      },
      "theme": {
          "color": "green",
          "icon": "av:library-add"
      },
  };
  // allow for importSite option
  if (commandRun.options.importSite) {
    if (!commandRun.options.importStructure) {
      // assume hax to hax if it's not defined
      commandRun.options.importStructure = 'haxcmsToSite';
    }
    // verify this is a valid way to do an import
    if (commandRun.options.importStructure && MicroFrontendRegistry.get(`@haxcms/${commandRun.options.importStructure}`)) {
      let resp = await openApiBroker('@haxcms', commandRun.options.importStructure, { repoUrl: commandRun.options.importSite});
      if (resp.res.data && resp.res.data.data && resp.res.data.data.items) {
        siteRequest.build.structure = 'import';
        siteRequest.build.items = resp.res.data.data.items;
      }
      if (resp.res.data && resp.res.data.data && resp.res.data.data.files) {
        siteRequest.build.files = resp.res.data.data.files;
      }
    }
    // hidden import methodologies
    else if (commandRun.options.importStructure) {
      if (commandRun.options.importStructure === 'drupal7-book-print-html') {
        let siteContent = await fetch(commandRun.options.importSite).then(d => d.ok ? d.text() : '');
        if (siteContent) {
          // @todo refactor to support 9 levels of heirarchy as this is technically what Drupal supports
          let dom = parse(siteContent);
          // pull all of level 1 of hierarchy
          let depth;
          let order = 0;
          let parent = null;
          let items = [];
          for (let branch1 of dom.querySelectorAll('.section-2')) {
            parent = null;
            depth = 0;
            let itemID = branch1.getAttribute('id');
            let item = {
              id: itemID,
              order: order,
              indent: depth,
              title: branch1.querySelector('h1').innerText,
              slug: itemID.replace('-','/'),
              contents: branch1.querySelector(`.field.field-name-body .field-item`).innerHTML,
              parent: parent,
            };
            items.push(item);
            order++;
            depth = 1;
            let parent2 = itemID;
            let order2 = 0;
            for (let branch2 of branch1.querySelectorAll('.section-3')) {
              itemID = branch2.getAttribute('id');
              let item = {
                id: itemID,
                order: order2,
                indent: depth,
                title: branch2.querySelector('h1').innerText,
                slug: itemID.replace('-','/'),
                contents: branch2.querySelector(`.field.field-name-body .field-item`).innerHTML,
                parent: parent2,
              };
              items.push(item);
              order2++;
              depth = 2;
              let parent3 = itemID;
              let order3 = 0;
              for (let branch3 of branch2.querySelectorAll('.section-4')) {
                itemID = branch3.getAttribute('id');
                let item = {
                  id: itemID,
                  order: order3,
                  indent: depth,
                  title: branch3.querySelector('h1').innerText,
                  slug: itemID.replace('-','/'),
                  contents: branch3.querySelector(`.field.field-name-body .field-item`).innerHTML,
                  parent: parent3,
                };
                items.push(item);
                order3++;
              }
            }
            // obtain all images on the system to bring along with additional spider request
            let location = new URL(commandRun.options.importSite).origin;
            var files = {};
            for (let image of dom.querySelectorAll("img[src^='/']")) {
              if (!image.getAttribute('src').startsWith('//')) {
                files[image.getAttribute('src')] = `${location}${image.getAttribute('src')}`;
              }
            }
            siteRequest.build.files = files;
          }
          siteRequest.build.structure = 'import';
          siteRequest.build.items = items;
        }
      }
    }
  }
  HAXCMS.cliWritePath = `${project.path}`;
  let res = new Res();
  await hax.RoutesMap.post.createSite({body: siteRequest}, res);
  if (commandRun.options.v) {
    if (commandRun.options.format === 'yaml') {
      log(dump(res.data));
    }
    else {
      log(res.data);
    }
  }
  if (!commandRun.options.quiet) {
    s.stop(merlinSays(`${project.name} created!`));
    await setTimeout(500);
  }
  
  if (project.gitRepo && !commandRun.options.isMonorepo) {
    try {
      await exec(`cd ${project.path}/${project.name} && git init && git add -A && git commit -m "first commit" && git branch -M main${project.gitRepo ? ` && git remote add origin ${project.gitRepo}` : ''}`);    
    }
    catch(e) {        
    }
  }
  // options for install, git and other extras
  // can't launch if we didn't install first so launch implies installation
  if (project.extras.includes('launch')) {
    let optionPath = `${project.path}/${project.name}`;
    let command = `npx @haxtheweb/haxcms-nodejs`;
    if (!commandRun.options.quiet) {
    p.note(`${merlinSays(`I have summoned a sub-process daemon 👹`)}

🚀  Running your ${color.bold(project.type)} ${color.bold(project.name)}:
${color.underline(color.cyan(`http://localhost:${port}`))}

🏠  Launched: ${color.underline(color.bold(color.yellow(color.bgBlack(`${optionPath}`))))}
💻  Folder: ${color.bold(color.yellow(color.bgBlack(`cd ${optionPath}`)))}
📂  Open folder: ${color.bold(color.yellow(color.bgBlack(`open ${optionPath}`)))}
📘  VS Code Project: ${color.bold(color.yellow(color.bgBlack(`code ${optionPath}`)))}
🚧  Launch later: ${color.bold(color.yellow(color.bgBlack(`${command}`)))}

⌨️  To resume 🧙 Merlin press: ${color.bold(color.black(color.bgRed(` CTRL + C `)))}
`);
    }
      // at least a second to see the message print at all
      await setTimeout(1000);
      try {
      await exec(`cd ${optionPath} && ${command}`);
      }
      catch(e) {
      // don't log bc output is weird
      }
  }
  else if (!commandRun.options.quiet) {
    let nextSteps = `cd ${project.path}/${project.name} && hax start`;
    p.note(`${project.name} is ready to go. Run the following to start working with it:`);
    p.outro(nextSteps);
  }
}

export async function siteItemsOptionsList(activeHaxsite, skipId = null) {
  let items = activeHaxsite.manifest.orderTree(activeHaxsite.manifest.items);
  let optionItems = [];
  for (var i in items) {
    // ensure we remove self if operation is about page in question like parent selector
    if (items[i].id !== skipId) {
      optionItems.push({
        value: items[i].id,
        label: ` ${'-'.repeat(parseInt(items[i].indent))}${items[i].title}`
      })  
    }
  }
  return optionItems;
}

export async function siteThemeList() {
  let themes = await HAXCMS.getThemes();
  let items = [];
  for (var i in themes) {
    items.push({
      value: i,
      label: themes[i].name
    })
  }
  return items;
}

// @fork of the hax core util for this so that we avoid api difference between real dom and parse nodejs dom
async function nodeToHaxElement(node, eventName = "insert-element") {
  if (!node) {
    return null;
  }
  // build out the properties to send along
  var props = {};
  // support basic styles
  if (typeof node.getAttribute("style") !== typeof undefined) {
    props.style = node.getAttribute("style");
  }
  // don't set a null style
  if (props.style === null || props.style === "null") {
    delete props.style;
  }
  // test if a class exists, not everything scopes
  if (typeof node.getAttribute('class') !== typeof undefined) {
    props.class = node.getAttribute('class').replace("hax-active", "");
  }
  // test if a id exists as its a special case in attributes... of course
  if (typeof node.getAttribute('id') !== typeof undefined) {
    props.id = node.getAttribute("id");
  }
  let tmpProps;
  // weak fallback
  if (typeof tmpProps === typeof undefined) {
    tmpProps = node.__data;
  }
  // complex elements need complex support
  if (typeof tmpProps !== typeof undefined) {
    // run through attributes, though non-reflected props won't be here
    // run through props, we always defer to property values
    for (var property in tmpProps) {
      // make sure we only set things that have a value
      if (
        property != "class" &&
        property != "style" &&
        tmpProps.hasOwnProperty(property) &&
        typeof node[property] !== undefined &&
        node[property] != null &&
        node[property] != ""
      ) {
        props[property] = node[property];
      }
      // special support for false boolean
      else if (node[property] === false) {
        props[property] = false;
      } 
      else if (node[property] === true) {
        props[property] = true;
      }
      else if (node[property] === 0) {
        props[property] = 0;
      }
      else {
        // unknown prop setting / ignored
        //console.warn(node[property], property);
      }
    }
    for (var attribute in node._attrs) {
      // make sure we only set things that have a value
      if (
        typeof node._attrs[attribute] !== typeof undefined &&
        attribute != "class" &&
        attribute != "style" &&
        attribute != "id" &&
        typeof node._attrs[attribute] !== undefined &&
        node._attrs[attribute] != null &&
        node._attrs[attribute] != ""
      ) {
        props[attribute] = node._attrs[attribute];
      }
      else if (node._attrs[attribute] == "0") {
        props[attribute] = node._attrs[attribute];
      }
      else {
        // note: debug here if experiencing attributes that won't bind
      }
    }
  } else {
    // much easier case, usually just in primatives
    for (var attribute in node._attrs) {
      // make sure we only set things that have a value
      if (
        typeof node._attrs[attribute] !== typeof undefined &&
        attribute != "class" &&
        attribute != "style" &&
        attribute != "id" &&
        typeof node._attrs[attribute] !== undefined &&
        node._attrs[attribute] != null &&
        node._attrs[attribute] != ""
      ) {
        props[attribute] = node._attrs[attribute];
      }
    }
  }
  // support sandboxed environments which
  // will hate iframe tags but love webview
  let tag = node.tagName.toLowerCase();
  if (globalThis.HaxStore && globalThis.HaxStore.instance && globalThis.HaxStore.instance._isSandboxed && tag === "iframe") {
    tag = "webview";
  }
  let slotContent = '';
  // if hax store around, allow it to get slot content of the node
  if (globalThis.HaxStore && globalThis.HaxStore.instance) {
    slotContent = await globalThis.HaxStore.instance.getHAXSlot(node);
  }
  else {
    // if HAX isn't around, just return the innerHTML as a string for asignment to content
    slotContent = node.innerHTML;
  }
  // support fallback on inner text if there were no nodes
  if (slotContent == "") {
    slotContent = node.innerText;
  }
  let element = {
    tag: tag,
    properties: props,
    content: slotContent,
  };
  if (eventName !== null) {
    element.eventName = eventName;
  }
  return element;
}