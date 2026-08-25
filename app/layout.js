const appShell = document.querySelector('.app-shell');
const leftPanel = document.querySelector('.left-panel');
const brand = document.querySelector('.brand');
const mainNav = document.querySelector('#main-nav');

function installLayoutStyles() {
  if (document.querySelector('#cc-layout-v053')) return;
  const style = document.createElement('style');
  style.id = 'cc-layout-v053';
  style.textContent = `
    html, body {
      width: 100%;
      height: 100%;
      min-height: 100%;
      background: #fff;
      overflow: hidden;
    }

    body {
      padding: 0;
    }

    .app-shell {
      width: 100vw;
      height: 100vh;
      min-height: 0;
      margin: 0;
      display: grid;
      grid-template-columns: 230px minmax(0, 1fr) 320px;
      grid-template-rows: 78px minmax(0, 1fr);
      grid-template-areas:
        "global global global"
        "left workspace right";
      background: var(--surface);
      box-shadow: none;
      overflow: hidden;
    }

    .app-global-topbar {
      grid-area: global;
      min-width: 0;
      min-height: 0;
      display: flex;
      align-items: stretch;
      background: var(--sidebar);
      border-bottom: 1px solid #e9dfbd;
      overflow: hidden;
      position: relative;
      z-index: 10;
    }

    .app-global-topbar .brand {
      width: 230px;
      min-width: 230px;
      min-height: 0;
      height: 100%;
      padding: 0 22px;
      border-bottom: 0;
      border-right: 1px solid #e9dfbd;
      flex: 0 0 230px;
    }

    #main-nav {
      min-width: 0;
      height: 100%;
      margin: 0;
      display: flex;
      align-items: stretch;
      gap: 0;
      flex: 1 1 auto;
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: none;
      overscroll-behavior-inline: contain;
    }

    #main-nav::-webkit-scrollbar {
      display: none;
    }

    #main-nav .nav-item {
      min-height: 78px;
      padding: 0 17px;
      display: flex;
      grid-template-columns: none;
      align-items: center;
      gap: 7px;
      flex: 0 0 auto;
      white-space: nowrap;
      font-size: 12px;
      text-align: center;
    }

    #main-nav .nav-item.is-active::before {
      left: 14px;
      right: 14px;
      bottom: 0;
      top: auto;
      width: auto;
      height: 3px;
    }

    #main-nav .nav-icon {
      font-size: 13px;
    }

    .left-panel {
      grid-area: left;
      min-height: 0;
    }

    .workspace {
      grid-area: workspace;
      min-height: 0;
    }

    .right-panel {
      grid-area: right;
      min-height: 0;
    }

    @media (max-width: 1120px) {
      .app-shell {
        width: 100vw;
        height: 100vh;
        min-height: 0;
        grid-template-columns: 205px minmax(0, 1fr);
        grid-template-rows: 78px minmax(0, 1fr);
        grid-template-areas:
          "global global"
          "left workspace";
      }

      .app-global-topbar .brand {
        width: 205px;
        min-width: 205px;
        flex-basis: 205px;
      }
    }

    @media (max-width: 680px) {
      .app-shell {
        display: grid;
        width: 100vw;
        height: 100vh;
        min-height: 0;
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: 78px minmax(0, 1fr);
        grid-template-areas:
          "global"
          "workspace";
      }

      .left-panel,
      .right-panel {
        display: none;
      }

      .workspace {
        min-height: 0;
      }

      .app-global-topbar .brand {
        width: 180px;
        min-width: 180px;
        flex-basis: 180px;
        padding-inline: 16px;
      }

      #main-nav .nav-item {
        padding-inline: 13px;
      }
    }

    @media (min-width: 2201px) {
      html, body {
        background: var(--bg);
      }

      body {
        padding: 32px;
      }

      .app-shell {
        width: min(2200px, calc(100vw - 64px));
        height: calc(100vh - 64px);
        margin: 0 auto;
        box-shadow: 0 18px 70px rgb(30 70 110 / 12%);
      }
    }
  `;
  document.head.appendChild(style);
}

function installGlobalTopbar() {
  if (!appShell || !leftPanel || !brand || !mainNav) return;
  if (document.querySelector('.app-global-topbar')) return;

  const topbar = document.createElement('header');
  topbar.className = 'app-global-topbar';
  topbar.setAttribute('aria-label', 'Application navigation');

  appShell.prepend(topbar);
  topbar.appendChild(brand);
  topbar.appendChild(mainNav);
}

installLayoutStyles();
installGlobalTopbar();

console.info('[CC layout] primary navigation moved to global yellow top bar');
