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

  'hv.action.cancel': 'Abbrechen',
  'hv.action.save': 'Speichern',
  'hv.action.saving': 'Wird gespeichert …',
  'hv.action.close': 'Schließen',
  'hv.action.edit': 'Bearbeiten',
  'hv.action.create': 'Erstellen',
  'hv.action.confirm': 'Bestätigen',
  'hv.action.delete': 'Löschen',
  'hv.action.remove': 'Entfernen',
  'hv.action.back': 'Zurück',
  'hv.action.open': 'Öffnen',
  'hv.action.repeat': 'Wiederholen',
  'hv.action.clearAll': 'Alle zurücksetzen',
  'hv.action.deleteItem': 'Gegenstand löschen',
  'hv.action.checkIn': 'Zurückgeben',
  'hv.action.checkOut': 'Ausleihen',
  'hv.action.checkOutEllipsis': 'Ausleihen …',

  'hv.term.noLocation': 'Kein Ort',
  'hv.term.checkedOut': 'Ausgeliehen',
  'hv.term.overdue': 'Überfällig',
  'hv.term.inspectionDue': 'Prüfung fällig',
  'hv.term.low': 'Niedrig',
  'hv.term.lowStock': 'Niedriger Bestand',
  'hv.term.notSet': 'Nicht gesetzt',
  'hv.term.yes': 'Ja',
  'hv.term.no': 'Nein',
  'hv.term.fileMissing': 'Datei fehlt',
  'hv.term.due': 'fällig {date}',
  'hv.term.overdueOn': 'Überfällig · {date}',
  'hv.term.checkedOutUntil': 'Ausgeliehen · fällig {date}',
  'hv.term.inspectionDueOn': 'Prüfung fällig · {date}',

  'hv.card.badge.low': '{count} niedrig',
  'hv.card.badge.lowTitle': 'Nur Gegenstände mit niedrigem Bestand anzeigen',
  'hv.card.badge.overdue': '{count} überfällig',
  'hv.card.badge.overdueTitle': 'Nur überfällige Gegenstände anzeigen',
  'hv.card.badge.inspection': '{count} zu prüfen',
  'hv.card.badge.inspectionTitle': 'Nur Gegenstände anzeigen, deren Prüfung fällig ist',
  'hv.card.badge.reminder': '{count} zu erledigen',
  'hv.card.badge.reminderTitle': 'Nur Gegenstände anzeigen, deren Erinnerung fällig ist',
  'hv.card.badge.checkedOut': '{count} ausgeliehen',
  'hv.card.badge.checkedOutTitle': 'Nur ausgeliehene Gegenstände anzeigen',
  'hv.card.openFullView': 'Volle Ansicht öffnen',
  'hv.card.addItem': 'Gegenstand hinzufügen',
  'hv.card.addShort': 'Neu',
  'hv.card.searchItems': 'Gegenstände durchsuchen',
  'hv.card.searchPlaceholder': 'Gegenstände durchsuchen …',
  'hv.card.searchAllPlaceholder.one': '{count} Gegenstand durchsuchen …',
  'hv.card.searchAllPlaceholder.other': 'Alle {count} Gegenstände durchsuchen …',
  'hv.card.filters': 'Filter',
  'hv.card.filtersActive': '{count} aktiv',
  'hv.card.showItems': 'Gegenstände anzeigen',
  'hv.card.showCount.one': '{count} Gegenstand anzeigen',
  'hv.card.showCount.other': '{count} Gegenstände anzeigen',
  'hv.card.newItem': 'Neuer Gegenstand',
  'hv.card.notConnected': 'Noch nicht mit Home Assistant verbunden.',

  'hv.list.noLongerMatches': 'Passt nicht mehr zu den aktuellen Filtern',

  'hv.row.label': 'Gegenstand {name}',
  'hv.row.select': '{name} auswählen',
  'hv.row.hasDocument': 'Hat ein Dokument',
  'hv.row.pending': 'Ausstehend',
  'hv.row.decreaseQuantity': 'Menge verringern',
  'hv.row.increaseQuantity': 'Menge erhöhen',
  'hv.row.editItem': 'Gegenstand bearbeiten',
  'hv.row.editNamed': '{name} bearbeiten',
  'hv.row.actionsFor': 'Aktionen für {name}',
  'hv.row.menu.changeDueDate': 'Rückgabedatum ändern …',
  'hv.row.menu.setDueDate': 'Rückgabedatum setzen …',

  'hv.sheet.label': 'Gegenstand',
  'hv.sheet.documents': 'Dokumente',
  'hv.sheet.documentAdded': 'hinzugefügt {when}',
  'hv.sheet.openPhoto': '{photo} öffnen',
  'hv.sheet.lowStockAt': 'niedriger Bestand ab {threshold}',
  'hv.sheet.fact.due': 'Rückgabe',
  'hv.sheet.fact.nextInspection': 'Nächste Prüfung',
  'hv.sheet.fact.reminder': 'Erinnerung',
  'hv.sheet.fact.updated': 'Geändert',
  'hv.sheet.updatedValue': '{when} · v{version}',
  'hv.sheet.markDone': 'Erledigt',
  'hv.sheet.markDoneTitle':
    'Diese Erinnerung als erledigt markieren und auf ihren nächsten Termin setzen',
  'hv.sheet.editDetails': 'Details bearbeiten',
  'hv.sheet.editItem': 'Gegenstand bearbeiten',

  'hv.editor.heading.new': 'Neuer Gegenstand',
  'hv.editor.heading.editing': '{name} – wird bearbeitet',
  'hv.editor.version': 'v{version} · geändert {when}',
  'hv.editor.close': 'Formular schließen',
  'hv.editor.field.name': 'Name',
  'hv.editor.field.quantity': 'Menge',
  'hv.editor.field.lowStock': 'Niedriger Bestand ab',
  'hv.editor.field.description': 'Beschreibung',
  'hv.editor.field.status': 'Status',
  'hv.editor.field.location': 'Ort',
  'hv.editor.field.category': 'Kategorie',
  'hv.editor.field.tags': 'Labels',
  'hv.editor.field.tagsNote': '· immer kleingeschrieben',
  'hv.editor.categoryPlaceholder': 'Keine Kategorie',
  'hv.editor.showAllCategories': 'Alle Kategorien anzeigen',
  'hv.editor.categoryEmpty':
    'Keine vorhandene Kategorie passt zu „{typed}“ – beim Speichern wird sie neu angelegt.',
  'hv.editor.locationCreateFailed': 'Der Ort konnte nicht angelegt werden.',
  'hv.editor.checkOutCaption': 'Ausleihe',
  'hv.editor.dueDate': 'Rückgabedatum',
  'hv.editor.dueDateHint': 'Ein Rückgabedatum gilt, solange der Gegenstand ausgeliehen ist.',
  'hv.editor.thisItem': 'diesen Gegenstand',
  'hv.editor.nextInspection': 'Nächste Prüfung',
  'hv.editor.reminder': 'Erinnerung',
  'hv.editor.reminderDate': 'Erinnerungsdatum',
  'hv.editor.repeatEvery': 'Wiederholen alle',
  'hv.editor.repeatUnit': 'Einheit der Wiederholung',
  'hv.editor.reminderHint':
    'Wähle zuerst ein Datum; lass die Wiederholung leer für einen einmaligen Termin.',
  'hv.editor.unit.days': 'Tage',
  'hv.editor.unit.weeks': 'Wochen',
  'hv.editor.unit.months': 'Monate',
  'hv.editor.customDaysOffset': '+X Tage',
  'hv.editor.daysFromToday': 'Tage ab heute',
  'hv.editor.customFields': 'Eigene Felder',
  'hv.editor.fieldsSet': '{fields} gesetzt',
  'hv.editor.fieldKey': 'Feldschlüssel',
  'hv.editor.fieldKeyPlaceholder': 'schlüssel',
  'hv.editor.fieldType': 'Feldtyp',
  'hv.editor.fieldValue': 'Feldwert',
  'hv.editor.removeField': 'Feld entfernen',
  'hv.editor.removeNamedField': '{key} entfernen',
  'hv.editor.fieldFallbackName': 'Feld',
  'hv.editor.addField': 'Feld hinzufügen',
  'hv.editor.keySuggestions': 'Vorschläge:',
  'hv.editor.clearingUnsets': 'Ein geleerter Wert entfernt den Schlüssel beim Speichern.',
  'hv.editor.type.string': 'Text',
  'hv.editor.type.number': 'Zahl',
  'hv.editor.type.boolean': 'Ja/Nein',
  'hv.editor.type.date': 'Datum',
  'hv.editor.photos': 'Fotos',
  'hv.editor.addPhoto': 'Foto hinzufügen',
  'hv.editor.viewPhoto': '{photo} ansehen',
  'hv.editor.removePhoto': '{photo} entfernen',
  'hv.editor.movePhotoEarlier': 'Foto {position} nach vorne',
  'hv.editor.movePhotoLater': 'Foto {position} nach hinten',
  'hv.editor.makeCover': 'Als Titelbild',
  'hv.editor.makePhotoCover': 'Foto {position} zum Titelbild machen',
  'hv.editor.coverPhoto': 'Titelbild',
  'hv.editor.documents': 'Dokumente',
  'hv.editor.addManual': 'Anleitung hinzufügen',
  'hv.editor.openDocument': 'Dokument öffnen',
  'hv.editor.openNamed': '{name} öffnen',
  'hv.editor.removeNamed': '{name} entfernen',
  'hv.editor.titleFor': 'Titel für {filename}',
  'hv.editor.attachmentsLater': 'Fotos und Dokumente',
  'hv.editor.attachmentsHint':
    'Speichere den Gegenstand zuerst, um Fotos und Anleitungen hinzuzufügen.',
  'hv.editor.upload.retryNamed': '{name} erneut versuchen',
  'hv.editor.upload.dismissNamed': 'Fehlermeldung zu {name} schließen',
  'hv.editor.upload.progress': '{name}: {state}',
  'hv.editor.upload.state.queued': 'in der Warteschlange …',
  'hv.editor.upload.state.preparing': 'wird vorbereitet …',
  'hv.editor.upload.state.uploading': 'wird hochgeladen …',
  'hv.editor.upload.failed': 'Hochladen fehlgeschlagen.',
  'hv.editor.upload.reorderPhotos': 'Fotos neu ordnen',
  'hv.editor.upload.removeDocument': 'Dokument entfernen',
  'hv.editor.upload.removePhoto': 'Foto entfernen',
  'hv.editor.upload.renameDocument': 'Dokument umbenennen',
  'hv.editor.preflight.tooManyDocuments': '{cap} Dokumente sind das Limit für einen Gegenstand.',
  'hv.editor.preflight.tooManyPhotos': '{cap} Fotos sind das Limit für einen Gegenstand.',
  'hv.editor.preflight.tooBig': '{size} liegt über dem Limit von {limit}.',
  'hv.editor.preflight.badDocumentType': '{type} ist kein zulässiger Dokumenttyp.',
  'hv.editor.preflight.badImageType': '{type} ist kein zulässiger Bildtyp.',
  'hv.editor.removePhoto.heading': 'Dieses Foto entfernen?',
  'hv.editor.removePhoto.message':
    'Die Fotodatei wird mit entfernt, und es gibt keinen Weg zurück.',
  'hv.editor.removeDocument.heading': 'Dieses Dokument entfernen?',
  'hv.editor.removeDocument.message':
    'Die Dokumentdatei wird mit entfernt, und es gibt keinen Weg zurück.',
  'hv.editor.moreFields': 'Weitere Felder',
  'hv.editor.moreSummaryFallback': 'Beschreibung · Daten · eigene Felder',
  'hv.editor.summary.description': 'Beschreibung',
  'hv.editor.summary.dates': 'Daten',
  'hv.editor.summary.reminder': 'Erinnerung',
  'hv.editor.summary.custom': '{count} eigene',
  'hv.editor.keyHint': 'Esc schließt · {chord} speichert',

  'hv.checkout.setDueDate': 'Rückgabedatum setzen',
  'hv.checkout.setADueDate': 'Ein Rückgabedatum setzen',
  'hv.checkout.checkOutNamed': '{name} ausleihen',
  'hv.checkout.sub':
    'Ein Rückgabedatum ist optional – es ist das, was die Überfällig-Markierung möglich macht.',
  'hv.checkout.noDueDate': 'Kein Rückgabedatum',
  'hv.checkout.clearDueDate': 'Rückgabedatum entfernen',
  'hv.checkout.withoutDueDate': 'Ohne Rückgabedatum ausleihen',
  'hv.checkout.set': 'Setzen',
  'hv.checkout.confirmWithDate': '{action} · fällig {date}',

  'hv.tree.label': 'Orte',
  'hv.tree.allItems': 'Alle Gegenstände',
  'hv.tree.noArea': 'Kein Bereich',
  'hv.tree.noneMatch': 'Keine Orte gefunden',
  'hv.tree.noneYet': 'Noch keine Orte',
  'hv.tree.newLocation': 'Neuer Ort …',
  'hv.tree.newLocationName': 'Name des neuen Ortes',
  'hv.tree.locationNamePlaceholder': 'Name des Ortes',
  'hv.tree.collapse': '{name} zuklappen',
  'hv.tree.expand': '{name} aufklappen',
  'hv.tree.actionsFor': 'Aktionen für {name}',
  'hv.tree.merge': '{name} zusammenführen',
  'hv.tree.mergeTitle': 'Mit einem anderen Ort zusammenführen',
  'hv.tree.edit': '{name} bearbeiten',
  'hv.tree.editTitle': 'Ort bearbeiten',
  'hv.tree.delete': '{name} löschen',
  'hv.tree.deleteTitle': 'Ort löschen',

  'hv.confirm.heading': 'Bist du sicher?',
  'hv.bottomSheet.label': 'Details',
  'hv.chipInput.placeholder': 'Label hinzufügen …',
  'hv.lightbox.close': 'Foto schließen',
  'hv.lightbox.previous': 'Vorheriges Foto',
  'hv.lightbox.next': 'Nächstes Foto',
  'hv.lightbox.counter': '{index} von {total}',

  'hv.surfaces.delete.heading': '„{name}“ löschen?',
  'hv.surfaces.delete.message':
    'Das lässt sich nicht rückgängig machen. Der Gegenstand verschwindet bei allen verbundenen Clients.',
  'hv.surfaces.menu.selectItems': 'Gegenstände auswählen …',
  'hv.surfaces.menu.organize': 'Verwalten …',
  'hv.surfaces.menu.organizeMeta': 'Orte · Labels · Kategorien · Status',
  'hv.surfaces.menu.columns': 'Spalten …',
  'hv.surfaces.menu.refresh': 'Daten aktualisieren',
  'hv.surfaces.menu.refreshMeta': 'Gegenstände · Orte · Statistik',
  'hv.surfaces.menu.diagnostics': 'Diagnose',
  'hv.surfaces.menu.data': 'Daten',
  'hv.surfaces.menu.exportAll': 'Backup exportieren',
  'hv.surfaces.menu.exportAllSub': 'Alles',
  'hv.surfaces.menu.exportAllCount.one': '{count} Gegenstand · alle Orte',
  'hv.surfaces.menu.exportAllCount.other': 'Alle {count} Gegenstände · alle Orte',
  'hv.surfaces.menu.exportView': 'Aktuelle Ansicht exportieren',
  'hv.surfaces.menu.exportViewSub': 'Aktiver Filter · behält Ortspfade',
  'hv.surfaces.menu.import': 'Backup importieren …',
  'hv.surfaces.badge.dropped': '{count} verworfen',
  'hv.surfaces.badge.offline': 'offline',
  'hv.surfaces.columnsHeading': 'Spalten der vollen Ansicht',
  'hv.surfaces.importCheckFailed': 'Dieses Dokument konnte nicht geprüft werden.',
  'hv.surfaces.importFailed': 'Der Import ist fehlgeschlagen.',

  'hv.cardEditor.title': 'Titel',
};
