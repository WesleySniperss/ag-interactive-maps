/**
 * Language switcher for the AG Interactive Maps compendium.
 *
 * The compendium pack keeps the original (Russian) text. A translation dictionary maps every original string to its
 * translation, and the language chosen in the module settings is applied:
 * - to the compendium index and loaded Adventure documents (names and descriptions shown in the compendium),
 * - to the Adventure contents while they are being imported (preImportAdventure hook),
 * - to maps that were already imported into the world, whenever the language changes.
 */

const MODULE_ID = "ag-interactive-maps";
const PACK_ID = `${MODULE_ID}.maps`;
const ORIGINAL_LANGUAGE = "ru";
const LANGUAGES = {
  uk: "Українська",
  ru: "Русский"
};

/** @type {Map<string, string>|null} Original text → Ukrainian text */
let dictionary = null;

/** Original names of compendium index entries, by document id. */
const originalIndexNames = new Map();

/** Original name and description of loaded Adventure documents. */
const originalSources = new WeakMap();

/* -------------------------------------------- */
/*  Translation helpers                         */
/* -------------------------------------------- */

const getLanguage = () => game.settings.get(MODULE_ID, "language");

async function loadDictionary() {
  if ( dictionary ) return dictionary;
  const response = await fetch(foundry.utils.getRoute(`modules/${MODULE_ID}/translations/uk.json`));
  dictionary = new Map(Object.entries(await response.json()));
  return dictionary;
}

/**
 * Translate an original string into the requested language.
 * Strings that are missing from the dictionary are returned unchanged.
 */
function translate(text, lang) {
  if ( (lang === ORIGINAL_LANGUAGE) || (typeof text !== "string") ) return text;
  return dictionary?.get(text) ?? text;
}

/** Compare HTML loosely, so that whitespace or <br> formatting differences do not matter. */
const normalize = text => text.replace(/<br\s*\/?>/g, "<br>").replace(/\s+/g, " ").trim();

/**
 * Decide what a world document field should become after a language switch.
 * Only fields that still hold either the original or the translated text are changed, so user edits are kept.
 * @returns {string|undefined} The new value, or undefined if the field should not be touched
 */
function retranslate(current, original, lang) {
  if ( (typeof current !== "string") || (typeof original !== "string") ) return undefined;
  const translated = dictionary.get(original);
  if ( translated === undefined ) return undefined;
  const target = translate(original, lang);
  const value = normalize(current);
  if ( value === normalize(target) ) return undefined;
  if ( (value === normalize(original)) || (value === normalize(translated)) ) return target;
  return undefined;
}

/* -------------------------------------------- */
/*  Compendium                                  */
/* -------------------------------------------- */

function localizeIndex(pack, lang) {
  for ( const entry of pack.index ) {
    if ( !originalIndexNames.has(entry._id) ) originalIndexNames.set(entry._id, entry.name);
    entry.name = translate(originalIndexNames.get(entry._id), lang);
  }
}

/** Translate the name and description an Adventure shows in the compendium and in its importer. */
function localizeAdventure(adventure, lang) {
  let original = originalSources.get(adventure);
  if ( !original ) {
    original = {name: adventure._source.name, description: adventure._source.description};
    originalSources.set(adventure, original);
  }
  adventure.updateSource({
    name: translate(original.name, lang),
    description: translate(original.description, lang)
  });
}

/** Translate the contents of an Adventure that is being imported. */
function localizeImportData(documents, lang) {
  for ( const folder of documents.Folder ?? [] ) folder.name = translate(folder.name, lang);
  for ( const journal of documents.JournalEntry ?? [] ) {
    journal.name = translate(journal.name, lang);
    for ( const page of journal.pages ?? [] ) {
      page.name = translate(page.name, lang);
      if ( page.text ) page.text.content = translate(page.text.content, lang);
    }
  }
  for ( const scene of documents.Scene ?? [] ) {
    scene.name = translate(scene.name, lang);
    scene.navName = translate(scene.navName, lang);
    for ( const drawing of scene.drawings ?? [] ) drawing.text = translate(drawing.text, lang);
  }
}

/** Translate the compendium index and every Adventure loaded from the pack, now and whenever it is reloaded. */
function patchPack(pack) {
  const {getDocuments, getIndex} = pack;
  pack.getDocuments = async function(...args) {
    const documents = await getDocuments.apply(this, args);
    const lang = getLanguage();
    for ( const adventure of documents ) localizeAdventure(adventure, lang);
    localizeIndex(this, lang);
    return documents;
  };
  pack.getIndex = async function(...args) {
    const index = await getIndex.apply(this, args);
    localizeIndex(this, getLanguage());
    return index;
  };
  localizeIndex(pack, getLanguage());
}

/* -------------------------------------------- */
/*  World documents                             */
/* -------------------------------------------- */

/**
 * Apply the language to the folders, journals and scenes that were imported from the pack.
 * @returns {Promise<number>} The number of changed documents
 */
async function localizeWorld(lang) {
  const pack = game.packs.get(PACK_ID);
  const folderUpdates = [];
  const journalUpdates = [];
  const sceneUpdates = [];
  const embeddedUpdates = [];

  for ( const adventure of await pack.getDocuments() ) {
    const data = adventure.toObject();

    for ( const source of data.folders ) {
      const name = retranslate(game.folders.get(source._id)?.name, source.name, lang);
      if ( name !== undefined ) folderUpdates.push({_id: source._id, name});
    }

    for ( const source of data.journal ) {
      const journal = game.journal.get(source._id);
      if ( !journal ) continue;
      const name = retranslate(journal.name, source.name, lang);
      if ( name !== undefined ) journalUpdates.push({_id: source._id, name});
      const pageUpdates = [];
      for ( const pageSource of source.pages ) {
        const page = journal.pages.get(pageSource._id);
        if ( !page ) continue;
        const update = {};
        const pageName = retranslate(page.name, pageSource.name, lang);
        if ( pageName !== undefined ) update.name = pageName;
        const content = retranslate(page.text?.content, pageSource.text?.content, lang);
        if ( content !== undefined ) update["text.content"] = content;
        if ( !foundry.utils.isEmpty(update) ) pageUpdates.push({_id: pageSource._id, ...update});
      }
      if ( pageUpdates.length ) embeddedUpdates.push([journal, "JournalEntryPage", pageUpdates]);
    }

    for ( const source of data.scenes ) {
      const scene = game.scenes.get(source._id);
      if ( !scene ) continue;
      const update = {};
      const name = retranslate(scene.name, source.name, lang);
      if ( name !== undefined ) update.name = name;
      const navName = retranslate(scene.navName, source.navName, lang);
      if ( navName !== undefined ) update.navName = navName;
      if ( !foundry.utils.isEmpty(update) ) sceneUpdates.push({_id: source._id, ...update});
      const drawingUpdates = [];
      for ( const drawingSource of source.drawings ) {
        const text = retranslate(scene.drawings.get(drawingSource._id)?.text, drawingSource.text, lang);
        if ( text !== undefined ) drawingUpdates.push({_id: drawingSource._id, text});
      }
      if ( drawingUpdates.length ) embeddedUpdates.push([scene, "Drawing", drawingUpdates]);
    }
  }

  if ( folderUpdates.length ) await CONFIG.Folder.documentClass.updateDocuments(folderUpdates);
  if ( journalUpdates.length ) await CONFIG.JournalEntry.documentClass.updateDocuments(journalUpdates);
  if ( sceneUpdates.length ) await CONFIG.Scene.documentClass.updateDocuments(sceneUpdates);
  for ( const [parent, embeddedName, updates] of embeddedUpdates ) {
    await parent.updateEmbeddedDocuments(embeddedName, updates);
  }
  return folderUpdates.length + journalUpdates.length + sceneUpdates.length
    + embeddedUpdates.reduce((count, [, , updates]) => count + updates.length, 0);
}

/** Bring imported maps in line with the selected language, once per language change. */
async function syncWorld() {
  if ( !game.users.activeGM?.isSelf ) return;
  const lang = getLanguage();
  if ( game.settings.get(MODULE_ID, "appliedLanguage") === lang ) return;
  const count = await localizeWorld(lang);
  await game.settings.set(MODULE_ID, "appliedLanguage", lang);
  if ( count ) ui.notifications.info(game.i18n.format("AGIM.Notifications.WorldLocalized", {
    language: LANGUAGES[lang],
    count
  }));
}

async function onLanguageChange(lang) {
  if ( !game.user.isGM ) return;
  await loadDictionary();
  const pack = game.packs.get(PACK_ID);
  for ( const adventure of pack.contents ) localizeAdventure(adventure, lang);
  localizeIndex(pack, lang);
  pack.render();
  await syncWorld();
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "language", {
    name: "AGIM.Settings.Language.Name",
    hint: "AGIM.Settings.Language.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: LANGUAGES,
    default: "uk",
    onChange: onLanguageChange
  });

  // The language the imported world documents were last translated to
  game.settings.register(MODULE_ID, "appliedLanguage", {
    scope: "world",
    config: false,
    type: String,
    default: ORIGINAL_LANGUAGE
  });
});

Hooks.once("ready", async () => {
  if ( !game.user.isGM ) return;
  const pack = game.packs.get(PACK_ID);
  if ( !pack ) return;
  await loadDictionary();
  patchPack(pack);
  pack.render();
  await syncWorld();
});

Hooks.on("preImportAdventure", (adventure, options, toCreate, toUpdate) => {
  if ( (adventure.pack !== PACK_ID) || !dictionary ) return;
  const lang = getLanguage();
  localizeImportData(toCreate, lang);
  localizeImportData(toUpdate, lang);
});
