import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    /**
     * PWA — instalação, não offline.
     *
     * O objetivo é o aparelho tratar o sistema como um app (ícone na tela de
     * início, sem barra de navegador). **Funcionar offline não é objetivo**: os
     * dados são do servidor e nenhum dado de negócio fica guardado no aparelho.
     *
     * Daí a regra mais importante daqui: o service worker **nunca** intercepta
     * `/api/`. Um sorteio, uma lista de presença ou um saldo servidos de cache
     * seriam pior que um erro de rede — o organizador agiria sobre dado velho
     * sem saber.
     */
    VitePWA({
      registerType: 'autoUpdate',
      // O manifest é escrito à mão em `public/manifest.webmanifest` para ficar
      // legível e versionado; o plugin cuida só do service worker.
      manifest: false,
      workbox: {
        // **Só o shell** entra no precache. Com `**/*.js` o service worker
        // baixava 1,4 MB no primeiro acesso — incluindo o pacote de gráficos,
        // que só a tela de Estatísticas usa — e desfazia justamente o ganho do
        // carregamento por rota. O JavaScript vem sob demanda e fica no cache
        // de execução (`runtimeCaching`) depois de usado pela primeira vez.
        globPatterns: ['**/*.{css,html,svg,png,woff,woff2,webmanifest}'],
        navigateFallback: '/index.html',
        // Requisições à API jamais caem no app-shell nem em cache.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Só estáticos. A expressão exige a extensão no fim do caminho, o
            // que nunca casa com `/api/...`.
            urlPattern: /\.(?:js|css|woff2?|png|svg)$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'estaticos' },
          },
        ],
      },
      devOptions: {
        // Em desenvolvimento o service worker atrapalha o hot reload.
        enabled: false,
      },
    }),
  ],
  server: {
    port: Number(process.env.PORT) || 5173,
    watch: {
      usePolling: true,
    },
  },
  build: {
    rollupOptions: {
      output: {
        /**
         * Separação de pacotes por ciclo de vida.
         *
         * O bundle era único: qualquer alteração no código da aplicação
         * invalidava também o React e o MUI no cache do navegador. Separados,
         * as bibliotecas (que mudam raramente) ficam em cache entre deploys, e
         * `charts` — o mais pesado, usado só na tela de Estatísticas — só é
         * baixado por quem abre aquela tela.
         */
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@mui/x-charts')) return 'charts'
          if (id.includes('@dnd-kit')) return 'dnd'
          if (id.includes('@mui') || id.includes('@emotion')) return 'mui'
          if (id.includes('react-router') || /node_modules[\\/]react(-dom)?[\\/]/.test(id)) {
            return 'react'
          }
          return undefined
        },
      },
    },
  },
})
