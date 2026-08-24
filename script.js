    const PRECO_FICHA = 2.00;
    let dataCalendario = new Date(); 
    let dataRegistro = new Date();   

    const nomesMeses = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
    const diasSemana = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB"];
    
    function mudarTelaBase(idTela) {
        document.querySelectorAll('.tela-base').forEach(t => t.classList.remove('ativa'));
        document.getElementById(idTela).classList.add('ativa');
    }
    function abrirPopUp(idPopUp) { document.getElementById(idPopUp).classList.add('ativa'); }
    function fecharPopUp(idPopUp) { document.getElementById(idPopUp).classList.remove('ativa'); }

    // ================= SCRIPT BANCO DE DADOS (LOCALSTORAGE) =================
    function obterChaveData(data) {
        let d = String(data.getDate()).padStart(2, '0');
        let m = String(data.getMonth() + 1).padStart(2, '0');
        let a = data.getFullYear();
        return `openmesa_${a}_${m}_${d}`;
    }

    function buscarDadosData(data) {
        const chave = obterChaveData(data);
        const dados = localStorage.getItem(chave);
        if (dados) {
            return JSON.parse(dados);
        }
        return { refeicao: 0, marmita: 0 }; // Agora inicia perfeitamente ZERADO
    }

    function salvarDadosData(data, qtdRefeicao, qtdMarmita) {
        const chave = obterChaveData(data);
        const objeto = { refeicao: qtdRefeicao, marmita: qtdMarmita };
        localStorage.setItem(chave, JSON.stringify(objeto));
    }

    function somarDadosDiaAtual(addRefeicao, addMarmita) {
        let hoje = new Date();
        let dadosAtuais = buscarDadosData(hoje);
        dadosAtuais.refeicao += addRefeicao;
        dadosAtuais.marmita += addMarmita;
        salvarDadosData(hoje, dadosAtuais.refeicao, dadosAtuais.marmita);
    }

    // ================= SCANNER QR CODE =================
    let html5QrCode;
    let qtdScanMarmita = 0;
    let qtdScanRefeicao = 0;
    let ultimaLeitura = 0;

    function abrirScanner() {
        mudarTelaBase('tela_scanner');
        qtdScanMarmita = 0; qtdScanRefeicao = 0;
        document.getElementById('val_marmita').innerText = 0;
        document.getElementById('val_refeicao').innerText = 0;

        html5QrCode = new Html5Qrcode("reader");
        html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, onScanSuccess)
        .catch(() => { alert("Verifique as permissões de câmera."); fecharScanner(); });
    }

    function onScanSuccess(decodedText) {
        const agora = Date.now();
        if (agora - ultimaLeitura < 1500) return; 

        if (decodedText === "OPENMESA_MARMITA") {
            qtdScanMarmita++;
            document.getElementById('val_marmita').innerText = qtdScanMarmita;
            if(navigator.vibrate) navigator.vibrate(200);
            ultimaLeitura = agora;
        } else if (decodedText === "OPENMESA_REFEICAO") {
            qtdScanRefeicao++;
            document.getElementById('val_refeicao').innerText = qtdScanRefeicao;
            if(navigator.vibrate) navigator.vibrate(200);
            ultimaLeitura = agora;
        }
    }

    function fecharScanner() {
        if (html5QrCode) html5QrCode.stop().then(() => html5QrCode.clear()).catch(()=>{});
        mudarTelaBase('tela_inicial');
    }

    function confirmarScanner() {
        if (qtdScanMarmita === 0 && qtdScanRefeicao === 0) return alert("Nenhum código lido.");
        // Salva as leituras diretamente no banco de dados do dia de HOJE
        somarDadosDiaAtual(qtdScanRefeicao, qtdScanMarmita);
        if (html5QrCode) html5QrCode.stop().then(() => html5QrCode.clear());
        abrirPopUp('pop_sucesso');
    }

    // ================= FLUXO ADICIONAR MANUAL (BOTOES) =================
    function confirmarFichasPopUp() {
        const m = parseInt(document.getElementById('qtd_marmitas').value) || 0;
        const r = parseInt(document.getElementById('qtd_refeicoes').value) || 0;
        if (m + r === 0) return alert("Insira um valor.");
        document.getElementById('texto_confirmacao').innerText = `Deseja adicionar ${m + r} fichas?`;
        fecharPopUp('pop_adicionar_dados'); abrirPopUp('pop_confirmacao');
    }
    function voltarParaDados() { fecharPopUp('pop_confirmacao'); abrirPopUp('pop_adicionar_dados'); }
    function avancarParaSucesso() {
        const m = parseInt(document.getElementById('qtd_marmitas').value) || 0;
        const r = parseInt(document.getElementById('qtd_refeicoes').value) || 0;
        somarDadosDiaAtual(r, m); // Grava no Banco de dados do dia atual
        fecharPopUp('pop_confirmacao'); abrirPopUp('pop_sucesso');
    }
    function finalizarTodosFluxos() {
        fecharPopUp('pop_sucesso'); mudarTelaBase('tela_inicial');
        document.getElementById('qtd_marmitas').value = ''; document.getElementById('qtd_refeicoes').value = '';
    }

    // ================= CALENDÁRIO & HISTÓRICO =================
    function inicializarSeletores() {
        const sm = document.getElementById('select_mes'); const sa = document.getElementById('select_ano');
        nomesMeses.forEach((m, i) => sm.innerHTML += `<option value="${i}">${m}</option>`);
        for (let a = 2026; a <= 2030; a++) sa.innerHTML += `<option value="${a}">${a}</option>`;
    }
    inicializarSeletores();

    function abrirHistoricoPopUp() { renderizarCalendario(); abrirPopUp('pop_historico'); }
    
    function renderizarCalendario() {
        const ano = dataCalendario.getFullYear(); const mes = dataCalendario.getMonth();
        document.getElementById('select_mes').value = mes; document.getElementById('select_ano').value = ano;
        const grid = document.getElementById('calendario_dias'); grid.innerHTML = '';
        
        diasSemana.forEach(d => { let div = document.createElement('div'); div.className = 'dia-semana'; div.innerText = d; grid.appendChild(div); });
        const pri = new Date(ano, mes, 1).getDay(); const dias = new Date(ano, mes + 1, 0).getDate();
        for (let i = 0; i < pri; i++) grid.appendChild(document.createElement('div'));
        
        let hj = new Date();
        for (let i = 1; i <= dias; i++) {
            let div = document.createElement('div'); div.className = 'dia'; div.innerText = i;
            if (i === hj.getDate() && mes === hj.getMonth() && ano === hj.getFullYear()) div.classList.add('hoje');
            div.onclick = () => { fecharPopUp('pop_historico'); dataRegistro = new Date(ano, mes, i); atualizarRegistroCompleto(); };
            grid.appendChild(div);
        }
    }
    function mudarMes(delta) { dataCalendario.setMonth(dataCalendario.getMonth() + delta); renderizarCalendario(); }
    function irParaDataSelecionada() { dataCalendario.setMonth(document.getElementById('select_mes').value); dataCalendario.setFullYear(document.getElementById('select_ano').value); renderizarCalendario(); }
    
    function voltarParaCalendario() { fecharPopUp('pop_registro_detalhes'); abrirPopUp('pop_historico'); }

    // ================= TELA DE REGISTRO DIÁRIO =================
    function atualizarRegistroCompleto() {
        let d = String(dataRegistro.getDate()).padStart(2, '0'); 
        let m = String(dataRegistro.getMonth() + 1).padStart(2, '0');
        document.getElementById('data_registro_badge').innerText = `Data ${d} de ${m} (${dataRegistro.getFullYear()})`;
        
        // Puxa as informações diretamente do nosso Banco de Dados
        let dadosData = buscarDadosData(dataRegistro);
        document.getElementById('reg_qtd_refeicao').value = dadosData.refeicao;
        document.getElementById('reg_qtd_marmita').value = dadosData.marmita;

        // VALIDAÇÃO CRÍTICA: Bloquear edições fora do dia de HOJE
        let hoje = new Date();
        let ehHoje = dataRegistro.getDate() === hoje.getDate() && 
                     dataRegistro.getMonth() === hoje.getMonth() && 
                     dataRegistro.getFullYear() === hoje.getFullYear();

        if (ehHoje) {
            document.getElementById('reg_qtd_refeicao').disabled = false;
            document.getElementById('reg_qtd_marmita').disabled = false;
            document.getElementById('aviso_bloqueado').style.display = "none";
        } else {
            document.getElementById('reg_qtd_refeicao').disabled = true;
            document.getElementById('reg_qtd_marmita').disabled = true;
            document.getElementById('aviso_bloqueado').style.display = "block";
        }

        calcularValoresRegistro();
        abrirPopUp('pop_registro_detalhes');
    }

    function mudarDiaRegistro(delta) { 
        dataRegistro.setDate(dataRegistro.getDate() + delta); 
        atualizarRegistroCompleto(); 
    }

    function salvarEAtualizarInputManual() {
        const r = parseInt(document.getElementById('reg_qtd_refeicao').value) || 0;
        const m = parseInt(document.getElementById('reg_qtd_marmita').value) || 0;
        
        // Atualiza o banco de dados na hora se for alterado manualmente na tabela
        salvarDadosData(dataRegistro, r, m);
        calcularValoresRegistro();
    }

    function calcularValoresRegistro() {
        const qRef = parseInt(document.getElementById('reg_qtd_refeicao').value) || 0;
        const qMar = parseInt(document.getElementById('reg_qtd_marmita').value) || 0;
        const vRef = qRef * PRECO_FICHA; const vMar = qMar * PRECO_FICHA;

        document.getElementById('reg_val_refeicao').value = `R$ ${vRef.toFixed(2).replace('.', ',')}`;
        document.getElementById('reg_val_marmita').value = `R$ ${vMar.toFixed(2).replace('.', ',')}`;
        document.getElementById('reg_total_geral').innerText = `R$ ${(vRef+vMar).toFixed(2).replace('.', ',')}`;
    }
