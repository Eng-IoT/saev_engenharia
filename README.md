# SAVE Engenharia Local V1

MVP PWA local-first para apoio ao projeto de infraestrutura de recarga de veículos elétricos.

## Recursos
- Banco local IndexedDB
- Funciona offline após o primeiro carregamento
- Dashboard responsivo
- Cadastro de projetos
- Curva de carga simulada de 24 h
- DLM / limite de potência
- Pré-dimensionamento inicial de circuito
- Checklist técnico
- Memorial resumido para impressão/PDF
- Backup e restauração JSON
- Instalação como PWA em navegadores compatíveis

## Como abrir
### Opção recomendada
Sirva a pasta com um servidor HTTP local, por exemplo:

Python:
    python -m http.server 8080

Depois abra:
    http://localhost:8080

A instalação PWA e o Service Worker exigem HTTP/HTTPS (localhost é aceito).

### Observação técnica
A ferramenta é de pré-dimensionamento e pré-validação. Não substitui projeto executivo, responsabilidade técnica, leitura integral das normas, dados do fabricante ou aprovação da concessionária.

A tabela interna de ampacidade do módulo de circuito é apenas conservadora/didática e deve ser substituída, em uma versão de produção, por um motor normativo completo parametrizado por método de instalação, isolação, temperatura, agrupamento, número de condutores carregados e demais condições aplicáveis.
