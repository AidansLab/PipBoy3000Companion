(function () {
  const IMG_SIZE = 9220,
    playerlevel = player.getav('level') || 1,
    playerKarma = player.getav('karma') || 0;
  let imgFile,
    onRemove = null,
    modified = !1;
  const scroller = NV
    ? (function () {
        imgFile = E.openFile('DATA/REP.IMG', 'r');
        const factionRep = [
            'Idolized',
            'Liked',
            'Accepted',
            'Good-Natured Rascal',
            'Smiling Troublemaker',
            'Neutral',
            'Mixed',
            'Dark Hero',
            'Unpredictable',
            'Wild Child',
            'Soft-Hearted Devil',
            'Shunned',
            'Sneering Punk',
            'Merciful Thug',
            'Hated',
            'Vilified'
          ],
          allFactions = [
            'Boomers',
            'Brotherhood of Steel',
            "Caesar's Legion",
            'Followers of the Apocalypse',
            'Freeside',
            'Goodsprings',
            'Great Khans',
            'NCR',
            'Novac',
            'Powder Gangers',
            'Primm',
            'The Strip',
            'White Glove Society'
          ],
          uRep = loadJSONWithDefaults(
            'SETTINGS/REP.JSON',
            Object.fromEntries(allFactions.map((f) => [f, 5]))
          ),
          // Only show factions the player has actually discovered/interacted
          // with (companion-pushed via REP_VISIBLE.JSON). Falls back to all
          // factions if the file is missing/empty so a disconnected device
          // still shows the full list.
          visibleFactions = (function () {
            let vis;
            try {
              vis = JSON.parse(fs.readFileSync('SETTINGS/REP_VISIBLE.JSON'));
            } catch {
              return allFactions;
            }
            if (!Array.isArray(vis)) return allFactions;
            const filtered = vis.filter((f) => allFactions.includes(f));
            if (filtered.length > 0) return filtered;
            try {
              const repOnly = JSON.parse(fs.readFileSync('SETTINGS/REP.JSON'));
              const keys = Object.keys(repOnly).filter((f) => allFactions.includes(f));
              if (keys.length > 0) return keys;
            } catch {}
            return filtered;
          })(),
          displayFactions = visibleFactions,
          s = Pip.createScroller({
            width: 240,
            itemCount: displayFactions.length,
            getItem: (n) => ({ txt: displayFactions[n], n: n }),
            render: (i) => {
              try {
                const imgIdx = allFactions.indexOf(i.txt);
                (imgFile.seek(IMG_SIZE * (imgIdx >= 0 ? imgIdx : i.n)),
                  h
                    .drawImage(imgFile.read(IMG_SIZE), 280, 35)
                    .setFontAlign(0, -1)
                    .drawString(factionRep[uRep[i.txt]], 366, 215)
                    .drawString(i.txt, 366, 240));
              } catch (e) {
                debug(`Error drawing faction image: ${e}`);
              }
            }
          });
        function onKnob2(dir) {
          if (cmode) return;
          const fac = displayFactions[s.selectedIndex],
            v = E.clip(uRep[fac] + dir, 0, 15);
          v != uRep[fac] &&
            (Pip.playSound('HIGHLIGHT'),
            (uRep[fac] = v),
            (modified = !0),
            s.render());
        }
        function onFactionSync() {
          try {
            Object.assign(uRep, JSON.parse(fs.readFileSync('SETTINGS/REP.JSON')));
          } catch {}
          s.render();
        }
        return (
          Pip.onExclusive('knob2', onKnob2),
          Pip.on('factions', onFactionSync),
          (onRemove = function () {
            (Pip.removeListener('knob2', onKnob2),
              Pip.removeListener('factions', onFactionSync),
              modified &&
                !cmode &&
                (debug('Writing to REP.JSON'),
                fs.writeFileSync('SETTINGS/REP.JSON', JSON.stringify(uRep))));
          }),
          s
        );
      })()
    : (function () {
        const general = loadJSONWithDefaults(
          'SETTINGS/GENERAL.JSON',
          'SETTINGS/DEFAULT/GENERAL.JSON'
        );
        (Object.entries({ 'Atomic Command': 'SETTINGS/ATOMIC.JSON' }).forEach(
          (e) =>
            (function (a, b) {
              try {
                const scores = JSON.parse(fs.readFileSync(b));
                scores.length > 0 &&
                  scores[0].score &&
                  (general[a + ' Score'] = scores[0].score);
              } catch {
                debug('No scores');
              }
            })(e[0], e[1])
        ),
          (imgFile = E.openFile('DATA/KARMA.IMG', 'r')));
        const lvlIdx = Math.min(playerlevel - 1, 29);
        let karma, karmaLevel = 2;
        if (playerKarma > 249) {
          karmaLevel = playerKarma > 749 ? 4 : 3;
          karma = [
            'Vault Guardian', 'Vault Martyr', 'Sentinel', 'Defender', 'Dignitary',
            'Peacekeeper', 'Ranger of the Wastes', 'Protector', 'Urban Avenger', 'Exemplar',
            'Capitol Crusader', 'Paladin', 'Vault Legend', 'Ambassador of Peace', 'Urban Legend',
            'Hero of the Wastes', 'Paragon', 'Wasteland Savior', 'Saint', 'Last,Best Hope of Humanity',
            'Restorer of Faith', 'Model of Selflessness', 'Shepherd', 'Friend of the People', 'Champion of Justice',
            'Symbol of Order', 'Herald of Tranquility', 'Lightbringer', 'Earthly Angel', 'Messiah'
          ][lvlIdx];
        } else if (playerKarma < -249) {
          karmaLevel = playerKarma < -749 ? 0 : 1;
          karma = [
            'Vault Delinquent', 'Vault Outlaw', 'Opportunist', 'Plunderer', 'Fat Cat',
            'Marauder', 'Pirate of the Wastes', 'Reaver', 'Urban Invader', "Ne'er-do-well",
            'Capitol Crimelord', 'Defiler', 'Vault Boogeyman', 'Harbinger of War', 'Urban Superstition',
            'Villain of the Wastes', 'Fiend', 'Wasteland Destroyer', 'Evil Incarnate', 'Scourge of Humanity',
            'Architect of Doom', 'Bringer of Sorrow', 'Deceiver', 'Consort of Discord', 'Stuff of Nightmares',
            'Agent of Chaos', 'Instrument of Ruin', 'Soultaker', "Demon's Spawn", 'Devil'
          ][lvlIdx];
        } else {
          karma = [
            'Vault Dweller', 'Vault Renegade', 'Seeker', 'Wanderer', 'Citizen',
            'Adventurer', 'Vagabond of the Wastes', 'Mercenary', 'Urban Ranger', 'Observer',
            'Capitol Councilor', 'Keeper', 'Vault Descendant', 'Pinnacle of Survival', 'Urban Myth',
            'Strider of the Wastes', 'Beholder', 'Wasteland Watcher', 'Super-Human', 'Paradigm of Humanity',
            'Soldier of Fortune', 'Profiteer', 'Egocentric', 'Loner', 'Hero for Hire',
            'Model of Apathy', 'Person of Refinement', 'Moneygrubber', 'Gray Stranger', 'True Mortal'
          ][lvlIdx];
        }
        const s = Pip.createScroller({
          width: 240,
          itemCount: Object.entries(general).length,
          getItem: (n) => {
            const v = Object.entries(general)[n];
            return { txt: v[0], rtxt: v[1] };
          }
        });
        try {
          (imgFile.seek(IMG_SIZE * karmaLevel),
            h
              .drawImage(imgFile.read(IMG_SIZE), 280, 54)
              .setFontAlign(0, 1)
              .drawString(['Evil', 'Bad', 'Neutral', 'Good', 'Saintly'][karmaLevel], 366, 95)
              .setFontAlign(0, -1)
              .drawString(karma, 366, 215));
        } catch (e) {
          debug(`Error drawing Karma image: ${e}`);
        }
        function onKnob2(dir) {
          const stat = Object.keys(general)[s.selectedIndex],
            v = E.clip(general[stat] + dir, 0, 9999);
          v != general[stat] &&
            (Pip.playSound('HIGHLIGHT'),
            (general[stat] = v),
            (modified = !0),
            s.render());
        }
        return (
          Pip.onExclusive('knob2', onKnob2),
          (onRemove = function () {
            (Pip.removeListener('knob2', onKnob2),
              modified &&
                (debug('Writing to GENERAL.JSON'),
                fs.writeFileSync(
                  'SETTINGS/GENERAL.JSON',
                  JSON.stringify(general)
                )));
          }),
          s
        );
      })();
  return {
    id: 'GENERAL',
    remove: () => {
      (scroller.remove(), imgFile && imgFile.close(), onRemove && onRemove());
    }
  };
});
