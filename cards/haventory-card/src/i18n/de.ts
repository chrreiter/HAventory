/**
 * German.
 *
 * Register and vocabulary follow Home Assistant's own German, which is what
 * surrounds the card on every screen it renders on: informal address ("du"),
 * `Bereich` for an area, `Kategorie`, `Label`, a space before an ellipsis, an
 * en dash where the English writes an em dash, and German quotation marks
 * („…“) where the English writes straight ones.
 *
 * Three words the card had to choose for itself, because Home Assistant has no
 * equivalent:
 *
 * - an item is a **Gegenstand** — a physical thing a household owns, not an
 *   `Eintrag` (which is what Home Assistant calls a to-do line, and HAventory
 *   writes those onto a shopping list beside its own items) and not an
 *   `Artikel` (which is stock in a shop);
 * - a location is an **Ort**, short enough to carry a nesting level in front of
 *   it in the tree and not tied to geography the way `Standort` is;
 * - checking out is **Ausleihen**, checking in **Zurückgeben** — what a
 *   household actually does when someone takes a drill away.
 *
 * Typed as a complete record rather than a `Dictionary`, so an English string
 * added without a German one fails to compile instead of quietly falling back.
 */

import type { TranslationKey } from './en';

export const de: Record<TranslationKey, string> = {
  'hv.action.refresh': 'Aktualisieren',
  'hv.action.retry': 'Erneut versuchen',
  'hv.action.dismiss': 'Schließen',
  'hv.action.discard': 'Verwerfen',

  'hv.empty.loading.headline': 'Gegenstände werden geladen',
  'hv.empty.connectionLost.headline': 'Home Assistant ist nicht erreichbar',
  'hv.empty.connectionLost.detail': 'Die Liste füllt sich, sobald die Verbindung wieder steht.',
  'hv.empty.noMatches.headline': 'Keine Gegenstände passen zu diesen Filtern',
  'hv.empty.noMatches.clearAction': 'Alle zurücksetzen',
  'hv.empty.emptyLocation.headline': 'Nichts in {location}',
  'hv.empty.emptyLocation.headlineUnnamed': 'Nichts an diesem Ort',
  'hv.empty.emptyLocation.addAction': 'Hier hinzufügen',
  'hv.empty.emptyLocation.clearAction': 'Alles anzeigen',
  'hv.empty.noItems.headline': 'Noch keine Gegenstände',
  'hv.empty.noItems.detail':
    'Füge deinen ersten Gegenstand hinzu oder stelle ein Backup wieder her.',
  'hv.empty.noItems.addAction': 'Ersten Gegenstand hinzufügen',
  'hv.empty.noItems.importAction': 'Backup importieren',

  'hv.banner.connectionLost.heading': 'Verbindung unterbrochen',
  'hv.banner.connectionLost.message':
    ' · es werden die bereits geladenen Daten angezeigt. Änderungen werden möglicherweise nicht gespeichert.',
  'hv.banner.connectionLost.action': 'Neu verbinden',
  'hv.banner.liveUpdates.heading': 'Live-Aktualisierungen pausiert',
  'hv.banner.liveUpdates.cause.unavailable': 'HAventory ist nicht verfügbar',
  'hv.banner.liveUpdates.cause.rateLimited': 'Ratenbegrenzung aktiv',
  'hv.banner.liveUpdates.retrying':
    ' · {cause}. Es wird automatisch erneut versucht; bis dahin kann diese Liste veraltet sein.',
  'hv.banner.liveUpdates.stalled':
    ' · {cause}. Diese Liste kann veraltet sein, bis du aktualisierst.',
  'hv.banner.retrying.heading': 'Beschäftigt – wird wiederholt',
  'hv.banner.retrying.message.one': ' · {count} Änderung in der Warteschlange',
  'hv.banner.retrying.message.other': ' · {count} Änderungen in der Warteschlange',
  'hv.banner.rateLimited.heading': 'Ratenbegrenzung aktiv',
  'hv.banner.rateLimited.message':
    ' · einige Live-Aktualisierungen wurden möglicherweise verworfen, daher kann diese Liste veraltet sein.',
  'hv.banner.reloading.heading': 'Das Inventar wurde durch einen Import ersetzt',
  'hv.banner.reloading.message': ' · wird neu geladen …',
  'hv.banner.conflict.heading': 'Jemand anderes hat diesen Gegenstand geändert.',
  'hv.banner.conflict.viewLatest': 'Aktuellen Stand ansehen',
  'hv.banner.conflict.reapply': 'Meine Änderung erneut anwenden',

  'hv.discard.heading': 'Änderungen verwerfen?',
  'hv.discard.message': 'Alles, was du seit dem letzten Speichern eingegeben hast, geht verloren.',

  'hv.health.itemIdKeyMismatch.one':
    '{count} Gegenstand ist unter einem Schlüssel gespeichert, der nicht zu seiner ID passt.',
  'hv.health.itemIdKeyMismatch.other':
    '{count} Gegenstände sind unter Schlüsseln gespeichert, die nicht zu ihren IDs passen.',
  'hv.health.itemReferencesMissingLocation.one':
    '{count} Gegenstand verweist auf einen Ort, den es nicht mehr gibt – er erscheint unter „Kein Ort“.',
  'hv.health.itemReferencesMissingLocation.other':
    '{count} Gegenstände verweisen auf einen Ort, den es nicht mehr gibt – sie erscheinen unter „Kein Ort“.',
  'hv.health.itemMissingFromLocationIndex.one': '{count} Gegenstand fehlt im Ortsindex.',
  'hv.health.itemMissingFromLocationIndex.other': '{count} Gegenstände fehlen im Ortsindex.',
  'hv.health.checkedOutItemMissingFromIndex.one':
    '{count} ausgeliehener Gegenstand fehlt im Ausleih-Index.',
  'hv.health.checkedOutItemMissingFromIndex.other':
    '{count} ausgeliehene Gegenstände fehlen im Ausleih-Index.',
  'hv.health.nonCheckedOutItemInIndex.one':
    '{count} Gegenstand steht im Ausleih-Index, ist aber nicht ausgeliehen.',
  'hv.health.nonCheckedOutItemInIndex.other':
    '{count} Gegenstände stehen im Ausleih-Index, sind aber nicht ausgeliehen.',
  'hv.health.lowStockItemMissingFromIndex.one':
    '{count} Gegenstand mit niedrigem Bestand fehlt im Bestandsindex.',
  'hv.health.lowStockItemMissingFromIndex.other':
    '{count} Gegenstände mit niedrigem Bestand fehlen im Bestandsindex.',
  'hv.health.nonLowStockItemInIndex.one':
    '{count} Gegenstand steht im Bestandsindex, hat aber keinen niedrigen Bestand.',
  'hv.health.nonLowStockItemInIndex.other':
    '{count} Gegenstände stehen im Bestandsindex, haben aber keinen niedrigen Bestand.',
  'hv.health.tagsIndexUnknownItems.one':
    'Der Label-Index verweist auf {count} Gegenstand, den es nicht mehr gibt.',
  'hv.health.tagsIndexUnknownItems.other':
    'Der Label-Index verweist auf {count} Gegenstände, die es nicht mehr gibt.',
  'hv.health.categoryIndexUnknownItems.one':
    'Der Kategorie-Index verweist auf {count} Gegenstand, den es nicht mehr gibt.',
  'hv.health.categoryIndexUnknownItems.other':
    'Der Kategorie-Index verweist auf {count} Gegenstände, die es nicht mehr gibt.',
  'hv.health.checkedOutIndexUnknownItems.one':
    'Der Ausleih-Index verweist auf {count} Gegenstand, den es nicht mehr gibt.',
  'hv.health.checkedOutIndexUnknownItems.other':
    'Der Ausleih-Index verweist auf {count} Gegenstände, die es nicht mehr gibt.',
  'hv.health.lowStockIndexUnknownItems.one':
    'Der Bestandsindex verweist auf {count} Gegenstand, den es nicht mehr gibt.',
  'hv.health.lowStockIndexUnknownItems.other':
    'Der Bestandsindex verweist auf {count} Gegenstände, die es nicht mehr gibt.',
  'hv.health.locationIndexUnknownItems.one':
    'Der Ortsindex verweist auf {count} Gegenstand, den es nicht mehr gibt.',
  'hv.health.locationIndexUnknownItems.other':
    'Der Ortsindex verweist auf {count} Gegenstände, die es nicht mehr gibt.',
  'hv.health.locationIndexMissingLocation.one':
    'Der Ortsindex führt {count} Fach für einen Ort, den es nicht mehr gibt.',
  'hv.health.locationIndexMissingLocation.other':
    'Der Ortsindex führt {count} Fächer für Orte, die es nicht mehr gibt.',
  'hv.health.locationBucketMismatch.one':
    '{count} Fach im Ortsindex stimmt nicht mit den Gegenständen überein, die es führt.',
  'hv.health.locationBucketMismatch.other':
    '{count} Fächer im Ortsindex stimmen nicht mit den Gegenständen überein, die sie führen.',
  'hv.health.locationIdKeyMismatch.one':
    '{count} Ort ist unter einem Schlüssel gespeichert, der nicht zu seiner ID passt.',
  'hv.health.locationIdKeyMismatch.other':
    '{count} Orte sind unter Schlüsseln gespeichert, die nicht zu ihren IDs passen.',
  'hv.health.itemsTotalMismatch.one':
    'Die zwischengespeicherte Gesamtzahl der Gegenstände stimmt nicht mit den gespeicherten Gegenständen überein.',
  'hv.health.itemsTotalMismatch.other':
    'Die zwischengespeicherte Gesamtzahl der Gegenstände stimmt nicht mit den gespeicherten Gegenständen überein.',
  'hv.health.locationsTotalMismatch.one':
    'Die zwischengespeicherte Gesamtzahl der Orte stimmt nicht mit den gespeicherten Orten überein.',
  'hv.health.locationsTotalMismatch.other':
    'Die zwischengespeicherte Gesamtzahl der Orte stimmt nicht mit den gespeicherten Orten überein.',
  'hv.health.checkedOutCountMismatch.one':
    'Die zwischengespeicherte Zahl der ausgeliehenen Gegenstände stimmt nicht mit den gespeicherten Gegenständen überein.',
  'hv.health.checkedOutCountMismatch.other':
    'Die zwischengespeicherte Zahl der ausgeliehenen Gegenstände stimmt nicht mit den gespeicherten Gegenständen überein.',
  'hv.health.lowStockCountMismatch.one':
    'Die zwischengespeicherte Zahl der Gegenstände mit niedrigem Bestand stimmt nicht mit den gespeicherten Gegenständen überein.',
  'hv.health.lowStockCountMismatch.other':
    'Die zwischengespeicherte Zahl der Gegenstände mit niedrigem Bestand stimmt nicht mit den gespeicherten Gegenständen überein.',

  'hv.count.item.one': '{count} Gegenstand',
  'hv.count.item.other': '{count} Gegenstände',
  'hv.count.location.one': '{count} Ort',
  'hv.count.location.other': '{count} Orte',
  'hv.count.subLocation.one': '{count} Unterort',
  'hv.count.subLocation.other': '{count} Unterorte',
  'hv.count.tag.one': '{count} Label',
  'hv.count.tag.other': '{count} Labels',
  'hv.count.category.one': '{count} Kategorie',
  'hv.count.category.other': '{count} Kategorien',
  'hv.count.status.one': '{count} Status',
  'hv.count.status.other': '{count} Status',
  'hv.count.field.one': '{count} Feld',
  'hv.count.field.other': '{count} Felder',
  'hv.count.filter.one': '{count} Filter',
  'hv.count.filter.other': '{count} Filter',
  'hv.count.issue.one': '{count} Problem',
  'hv.count.issue.other': '{count} Probleme',
  'hv.count.problem.one': '{count} Problem',
  'hv.count.problem.other': '{count} Probleme',
  'hv.count.conflict.one': '{count} Konflikt',
  'hv.count.conflict.other': '{count} Konflikte',
  'hv.count.nameClash.one': '{count} Namenskonflikt',
  'hv.count.nameClash.other': '{count} Namenskonflikte',
  'hv.count.failedRow.one': '{count} fehlgeschlagene Zeile',
  'hv.count.failedRow.other': '{count} fehlgeschlagene Zeilen',

  'hv.list.showingAll.one': '{count} Gegenstand wird angezeigt',
  'hv.list.showingAll.other': '{count} Gegenstände werden angezeigt',
  'hv.list.showingOf.one': '{loaded} von {count} Gegenstand wird angezeigt',
  'hv.list.showingOf.other': '{loaded} von {count} Gegenständen werden angezeigt',
  'hv.list.showingOfMatching.one': '{loaded} von {count} passendem Gegenstand wird angezeigt',
  'hv.list.showingOfMatching.other': '{loaded} von {count} passenden Gegenständen werden angezeigt',

  'hv.rewrite.tag.remove.one': 'Entfernt „{from}“ von {count} Gegenstand.',
  'hv.rewrite.tag.remove.other': 'Entfernt „{from}“ von {count} Gegenständen.',
  'hv.rewrite.tag.retag.one': 'Ändert das Label bei {count} Gegenstand und entfernt „{from}“.',
  'hv.rewrite.tag.retag.other': 'Ändert das Label bei {count} Gegenständen und entfernt „{from}“.',
  'hv.rewrite.category.clear.one': 'Entfernt die Kategorie bei {count} Gegenstand.',
  'hv.rewrite.category.clear.other': 'Entfernt die Kategorie bei {count} Gegenständen.',
  'hv.rewrite.category.set.one': 'Ordnet {count} Gegenstand der Kategorie „{to}“ zu.',
  'hv.rewrite.category.set.other': 'Ordnet {count} Gegenstände der Kategorie „{to}“ zu.',

  'hv.bulk.result.failed.one': '{count} ist fehlgeschlagen und blieb unverändert.',
  'hv.bulk.result.failed.other': '{count} sind fehlgeschlagen und blieben unverändert.',
  'hv.fullView.checkedOutWarning.one': '{count} davon ist ausgeliehen',
  'hv.fullView.checkedOutWarning.other': '{count} davon sind ausgeliehen',
  'hv.surfaces.exportView.filtered.one': '{count} gefilterter Gegenstand · behält Ortspfade',
  'hv.surfaces.exportView.filtered.other': '{count} gefilterte Gegenstände · behält Ortspfade',

  'hv.time.justNow': 'gerade eben',
  'hv.date.offsetDays': '+{days} Tage',

  'hv.reminder.every.days.one': 'täglich',
  'hv.reminder.every.days.other': 'alle {count} Tage',
  'hv.reminder.every.weeks.one': 'wöchentlich',
  'hv.reminder.every.weeks.other': 'alle {count} Wochen',
  'hv.reminder.every.months.one': 'monatlich',
  'hv.reminder.every.months.other': 'alle {count} Monate',

  'hv.media.photoAlt': '{name} – Foto {index} von {total}',
  'hv.media.photoAltOnly': 'Foto von {name}',

  'hv.area.prefix': 'Bereich: {name}',
  'hv.area.srPrefix': 'Bereich: ',

  'hv.shortcut.ctrlEnter': 'Strg+Enter',

  'hv.form.error.nameRequired': 'Name ist erforderlich.',
  'hv.form.error.nameTooLong': 'Der Name darf höchstens {max} Zeichen lang sein.',
  'hv.form.error.descriptionTooLong': 'Die Beschreibung darf höchstens {max} Zeichen lang sein.',
  'hv.form.error.categoryTooLong': 'Die Kategorie darf höchstens {max} Zeichen lang sein.',
  'hv.form.error.quantityNegative': 'Die Menge darf nicht negativ sein.',
  'hv.form.error.lowStockRange':
    'Die Bestandsschwelle muss 0 oder größer sein – oder leer bleiben.',
  'hv.form.error.tooManyTags': 'Ein Gegenstand kann höchstens {max} Labels tragen.',
  'hv.form.error.tagTooLong': 'Jedes Label darf höchstens {max} Zeichen lang sein.',
  'hv.form.error.reminderRange':
    'Wiederholung von 1 bis {max}, oder leer lassen für einen einmaligen Termin.',
  'hv.form.error.customFieldDuplicate': '„{key}“ kommt zweimal vor.',
  'hv.form.error.customFieldKeyTooLong': 'Feldnamen dürfen höchstens {max} Zeichen lang sein.',
  'hv.form.error.customFieldNotNumber': '„{key}“ muss eine Zahl sein.',
  'hv.form.error.customFieldNotDate': '„{key}“ muss ein Datum sein.',
  'hv.form.error.customFieldValueTooLong': '„{key}“ darf höchstens {max} Zeichen lang sein.',
  'hv.form.error.tooManyCustomFields': 'Ein Gegenstand kann höchstens {max} eigene Felder tragen.',
};
