# GOUGOULE ⚔️ YAYA — La Guerre du Stream

Carte de guerre **en temps réel** (parodie) entre deux streamers Kick :

- **Opior** (`theblackwall`) = 🇷🇺 **Général Gougoule**, *Armée de la Goule* (Ténèbres)
- **Yaya** (`yayaaakl`) = 🇺🇦 *Armée de Yaya* (Résistance), multi-millionnaire

> ⚠️ **Fiction / parodie.** Aucun lien avec le conflit réel Russie–Ukraine.

## Fonctionnalités

- **Territoire** : un streamer **en ligne** avance, **hors ligne** recule. Plus de spectateurs = poussée plus forte.
- **Globe 3D** (three.js) figé et zoomé sur les deux pays, avec arcs de missiles + explosions.
- **Carte tactique** SVG : front mouvant, villes qui changent de camp, cratères de bombes.
- **Bombes via le chat uniquement** : spam d'une commande (`GOUGOULE` / `SLAVA`). **30 messages = 1 bombe**, **max 1 bombe / 30 min** par camp.
- **Assaut général** (~2×/jour) : bombes **×2 dégâts** (la bannière indique quoi spammer).
- **Connexion Kick (OAuth 2.1 + PKCE)** + choix du camp ; **les 2 chats Kick** affichés sur le site.
- **Armées** : chaque pseudo qui parle dans un chat monte en grade (Soldat → Général).
- **Connexion** (Kick OAuth en prod, pseudo en local) + **choix du camp**.
- **Pixel war** : chaque heure, un membre connecté peut frapper une case du **territoire ennemi**.
- **Modale Infos / Traité du jour**.
- **Fin de guerre après 1 semaine** → vainqueur + traité de paix.

## Lancer en local

```bash
cd streamer-war
node server.js 3000 demo     # "demo" = assauts accélérés pour tout voir
# puis http://localhost:3000
```

Aucune dépendance (Node ≥ 18, serveur HTTP natif). L'état est dans `state.json`.

## Variables d'environnement

| Variable             | Rôle                                                     |
|----------------------|----------------------------------------------------------|
| `PORT`               | Port d'écoute (défaut 3000)                               |
| `WAR_DEMO=1`         | Mode démo (assauts/pixels accélérés)                     |
| `WAR_RATE`           | Vitesse du front (% / minute)                            |
| `WAR_DAYS`           | Durée de la guerre (défaut 7)                            |
| `PUBLIC_URL`         | URL publique (pour l'OAuth Kick)                         |
| `KICK_CLIENT_ID`     | Client ID de ton app Kick                               |
| `KICK_CLIENT_SECRET` | Client Secret de ton app Kick                           |

---

## 1) Créer l'API Kick

Sur Kick → **Paramètres → Développeur → Créer une application** :

1. **Nom** : `Kick WAR` — **Description** : libre.
2. **URL de redirection** : `https://TON-URL/api/auth/kick/callback`
   (⚠️ tu n'as pas encore l'URL : **déploie d'abord** (étape 2), reviens ici coller l'URL).
3. **Webhooks** : pas nécessaires pour la connexion des viewers (laisse désactivé).
4. **Autorisations** : coche au minimum *Lire les informations de l'utilisateur* (pour le login).
5. **Créer** → note le **Client ID** et le **Client Secret**.

> **Lire le chat d'Opior et de Yaya** : l'API officielle ne permet de lire le chat d'une chaîne
> que si **cette chaîne autorise ton app**. Pour lire le chat **public** des deux streamers sans leur
> accord, on se branche sur le **socket de chat public de Kick (Pusher)** côté serveur. Le hook est
> déjà prêt dans `server.js` : `onChatMessage(side, user, text)`. Il faut juste y connecter Pusher
> avec les *chatroom IDs* des deux chaînes (récupérables une fois sur la page de la chaîne).

## 2) Déployer

### ✅ Recommandé : Render (ou Railway) — l'app tourne telle quelle

Ce projet est un **serveur Node persistant** (sessions, boucle temps réel, socket chat).
Un hébergeur persistant est le plus simple :

1. Pousse le dossier sur un repo GitHub.
2. [render.com](https://render.com) → **New → Web Service** → connecte le repo.
   - **Root Directory** : `streamer-war`
   - **Build Command** : *(vide)*
   - **Start Command** : `node server.js`
   - Plan **Free**.
3. **Environment** → ajoute `KICK_CLIENT_ID`, `KICK_CLIENT_SECRET`, et
   `PUBLIC_URL=https://TON-SERVICE.onrender.com`.
4. Deploy → tu obtiens ton URL HTTPS.
5. Retourne dans l'app Kick et colle `https://TON-SERVICE.onrender.com/api/auth/kick/callback`
   comme **URL de redirection**.

### ⚠️ Vercel

Vercel est génial pour du **statique / serverless**, mais il ne garde pas de processus qui tourne
(pas de boucle temps réel, pas de socket chat persistant, système de fichiers éphémère). Pour y
mettre **tout** ce projet, il faudrait le réécrire en *fonctions serverless* + un stockage externe
(**Upstash Redis / Vercel KV**) pour l'état partagé (territoire, armées, pixels, sessions), et gérer
le chat via webhooks. C'est faisable mais c'est un autre chantier.

👉 Pour aller vite : **Render**. L'URL de redirection Kick fonctionne avec n'importe quel hébergeur.
Si tu veux quand même la version Vercel (serverless + Upstash), c'est possible — demande-le.

## 3) Finaliser le login Kick

Le callback OAuth (`/api/auth/kick/callback`) est un **stub** : il faut y échanger le `code` contre un
token (`POST https://id.kick.com/oauth/token`) puis lire l'utilisateur, et créer la session. Le code
d'`/api/auth/kick` (redirection vers l'autorisation) est déjà en place et s'active automatiquement dès
que `KICK_CLIENT_ID` est défini.
