# Taux du dollar de la BNC

Chaque matin (du lundi au samedi), un petit robot lit le taux USD / HTG affiché par la Banque Nationale de Crédit sur
https://www.bnconline.com/ et l'écrit dans `taux-bnc.json` :

```json
{ "date": "2026-11-13", "achat": 129.25, "vente": 131.75, "brh": 130.7359 }
```

- `date` : la date affichée par la BNC ;
- `achat` et `vente` : gourdes pour 1 dollar (montants de 1 à 500 USD) ;
- `brh` : taux de référence de la BRH affiché sur la même page.

`historique.csv` garde une ligne par changement.

Ce fichier est lu par l'application NEXUS ERP (usage interne), qui en déduit son taux du jour.
Il ne contient que ces chiffres publics : aucune donnée d'entreprise.
