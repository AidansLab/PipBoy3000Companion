(function () {
  const playerlevel = player.getav('level') || 1,
    playerKarma = player.getav('karma') || 0;
  let imgFile,
    onRemove = null,
    modified = !1;
  const scroller = NV
    ? (function () {
        imgFile = E.openFile('DATA/REP.IMG', 'r');
        const factionRep = 'Idolized\nLiked\nAccepted\nGood-Natured Rascal\nSmiling Troublemaker\nNeutral\nMixed\nDark Hero\nUnpredictable\nWild Child\nSoft-Hearted Devil\nShunned\nSneering Punk\nMerciful Thug\nHated\nVilified'.split('\n'),
          allFactions = 'Boomers\nBrotherhood of Steel\nCaesar\'s Legion\nFollowers of the Apocalypse\nFreeside\nGoodsprings\nGreat Khans\nNCR\nNovac\nPowder Gangers\nPrimm\nThe Strip\nWhite Glove Society'.split('\n'),
          uRep = loadJSONWithDefaults(
            'SETTINGS/REP.JSON',
            Object.fromEntries(allFactions.map((f) => [f, 5]))
          ),
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
          displayFactions =
            cmode ? visibleFactions : allFactions,
          s = Pip.createScroller({
            width: 240,
            itemCount: displayFactions.length,
            getItem: (n) => ({ txt: displayFactions[n], n: n }),
            render: (i) => {
              const imgIdx = allFactions.indexOf(i.txt);
              (imgFile.seek(9220 * (imgIdx >= 0 ? imgIdx : i.n)),
                h
                  .drawImage(imgFile.read(9220), 280, 35)
                  .setFontAlign(0, -1)
                  .drawString(factionRep[uRep[i.txt]], 366, 215)
                  .drawString(i.txt, 366, 240));
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
            scroller.render());
        }
        function onFactionSync() {
          try {
            Object.assign(uRep, JSON.parse(fs.readFileSync('SETTINGS/REP.JSON')));
          } catch {}
          scroller.render();
        }
        return (
          Pip.onExclusive('knob2', onKnob2),
          Pip.on('factions', onFactionSync),
          (onRemove = function () {
            (Pip.removeListener('knob2', onKnob2),
              Pip.removeListener('factions', onFactionSync),
              modified &&
                !(cmode) &&
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
          karma = 'Vault Guardian\nVault Martyr\nSentinel\nDefender\nDignitary\nPeacekeeper\nRanger of the Wastes\nProtector\nUrban Avenger\nExemplar\nCapitol Crusader\nPaladin\nVault Legend\nAmbassador of Peace\nUrban Legend\nHero of the Wastes\nParagon\nWasteland Savior\nSaint\nLast,Best Hope of Humanity\nRestorer of Faith\nModel of Selflessness\nShepherd\nFriend of the People\nChampion of Justice\nSymbol of Order\nHerald of Tranquility\nLightbringer\nEarthly Angel\nMessiah'.split('\n')[lvlIdx];
        } else if (playerKarma < -249) {
          karmaLevel = playerKarma < -749 ? 0 : 1;
          karma = 'Vault Delinquent\nVault Outlaw\nOpportunist\nPlunderer\nFat Cat\nMarauder\nPirate of the Wastes\nReaver\nUrban Invader\nNe\'er-do-well\nCapitol Crimelord\nDefiler\nVault Boogeyman\nHarbinger of War\nUrban Superstition\nVillain of the Wastes\nFiend\nWasteland Destroyer\nEvil Incarnate\nScourge of Humanity\nArchitect of Doom\nBringer of Sorrow\nDeceiver\nConsort of Discord\nStuff of Nightmares\nAgent of Chaos\nInstrument of Ruin\nSoultaker\nDemon\'s Spawn\nDevil'.split('\n')[lvlIdx];
        } else {
          karma = 'Vault Dweller\nVault Renegade\nSeeker\nWanderer\nCitizen\nAdventurer\nVagabond of the Wastes\nMercenary\nUrban Ranger\nObserver\nCapitol Councilor\nKeeper\nVault Descendant\nPinnacle of Survival\nUrban Myth\nStrider of the Wastes\nBeholder\nWasteland Watcher\nSuper-Human\nParadigm of Humanity\nSoldier of Fortune\nProfiteer\nEgocentric\nLoner\nHero for Hire\nModel of Apathy\nPerson of Refinement\nMoneygrubber\nGray Stranger\nTrue Mortal'.split('\n')[lvlIdx];
        }
        const s = Pip.createScroller({
          width: 240,
          itemCount: Object.entries(general).length,
          getItem: (n) => {
            const v = Object.entries(general)[n];
            return { txt: v[0], rtxt: v[1] };
          }
        });
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
          imgFile.seek(9220 * karmaLevel),
          h
            .drawImage(imgFile.read(9220), 280, 54)
            .setFontAlign(0, 1)
            .drawString(
              ['Evil', 'Bad', 'Neutral', 'Good', 'Saintly'][karmaLevel],
              366,
              95
            )
            .setFontAlign(0, -1)
            .drawString(karma, 366, 215),
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
