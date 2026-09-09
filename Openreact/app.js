import React, { useState, useEffect } from 'react';
import { 
  StyleSheet, Text, View, TextInput, TouchableOpacity, 
  Modal, Alert, ScrollView 
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Camera, CameraView } from 'expo-camera';
import NetInfo from '@react-native-community/netinfo';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

const PRECO_FICHA = 2.00;
const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const INTERVALO_BACKUP_MS = 30 * 60 * 1000;

// CHAVES DE ACESSO PARA CADASTRO DE FUNCIONÁRIOS
const CHAVE_CAIXA = 'CAIXA123';
const CHAVE_FISCAL = 'FISCAL456';
const CHAVE_MESTRA_AUDITOR = 'MASTER_KEY_2026';

// PERMISSÕES PADRÃO POR PERFIL
const PERMISSOES_PADRAO = {
  CAIXA: ['add_fichas', 'qr_code', 'ver_historico'],
  FISCAL: ['marmitas_convenio', 'pagamentos_convenio', 'relatorios', 'ver_historico', 'editar_historico'],
  AUDITOR: ['ver_historico', 'editar_historico', 'editar_retroativo', 'sync_backup', 'gestao_usuarios', 'gestao_permissoes'],
  EMPRESA: ['fazer_pedido_empresa']
};

// BASE INICIAL DE USUÁRIOS
const USUARIOS_INICIAIS = [
  { id: '1', usuario: 'caixa', senha: '123', perfil: 'CAIXA', nome: 'Caixa Operacional', permissoes: [...PERMISSOES_PADRAO.CAIXA] },
  { id: '2', usuario: 'fiscal', senha: '456', perfil: 'FISCAL', nome: 'Fiscal do Restaurante', permissoes: [...PERMISSOES_PADRAO.FISCAL] },
  { id: '3', usuario: 'admin.auditor', senha: '789', perfil: 'AUDITOR', nome: 'Gerente Geral', permissoes: [...PERMISSOES_PADRAO.AUDITOR] },
  { id: '4', usuario: 'empresa', senha: '000', perfil: 'EMPRESA', nome: 'Empresa Parceira', permissoes: [...PERMISSOES_PADRAO.EMPRESA] },
];

export default function App() {
  // Autenticação e Perfis
  const [usuarios, setUsuarios] = useState(USUARIOS_INICIAIS);
  const [usuarioInput, setUsuarioInput] = useState('');
  const [senhaInput, setSenhaInput] = useState('');
  const [usuarioLogado, setUsuarioLogado] = useState(null);
  const [erroLogin, setErroLogin] = useState('');

  // Modo de Cadastro na Tela de Login
  const [modoCadastro, setModoCadastro] = useState(false);
  const [novoNome, setNovoNome] = useState('');
  const [novoUser, setNovoUser] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [chaveAcesso, setChaveAcesso] = useState('');

  // Navegação e Modais
  const [telaAtual, setTelaAtual] = useState('tela_login');
  const [modalAtivo, setModalAtivo] = useState(null);

  // Contingência e Backups
  const [modoContingencia, setModoContingencia] = useState(false);
  const [qtdPendentes, setQtdPendentes] = useState(0);
  const [ultimoBackup, setUltimoBackup] = useState(null);

  // Formulário Manual & Empresa
  const [qtdMarmitas, setQtdMarmitas] = useState('');
  const [qtdRefeicoes, setQtdRefeicoes] = useState('');
  const [nomeSolicitanteEmpresa, setNomeSolicitanteEmpresa] = useState('');
  const [nomeEmpresaPedido, setNomeEmpresaPedido] = useState('');
  const [qtdMarmitasEmpresa, setQtdMarmitasEmpresa] = useState('');

  // Filtro de Datas Personalizadas para Relatório
  const [dataInicioRelatorio, setDataInicioRelatorio] = useState('');
  const [dataFimRelatorio, setDataFimRelatorio] = useState('');

  // Pedidos de Convênio
  const [pedidosConvenio, setPedidosConvenio] = useState([]);
  const [pedidoSelecionadoDetalhe, setPedidoSelecionadoDetalhe] = useState(null);
  const [pedidosSelecionadosPagamento, setPedidosSelecionadosPagamento] = useState([]);

  // Scanner QR Code
  const [hasPermission, setHasPermission] = useState(null);
  const [scanned, setScanned] = useState(false);
  const [scanCounts, setScanCounts] = useState({ marmita: 0, refeicao: 0 });

  // Calendário e Histórico
  const [dataCalendario, setDataCalendario] = useState(new Date());
  const [dataRegistro, setDataRegistro] = useState(new Date());
  const [registroDia, setRegistroDia] = useState({ refeicao: 0, marmita: 0, convenio: 0, pendentes: 0 });

  // Gestão de Usuários (Auditor Interno)
  const [novoUserNome, setNovoUserNome] = useState('');
  const [novoUserUsuario, setNovoUserUsuario] = useState('');
  const [novoUserSenha, setNovoUserSenha] = useState('');
  const [novoUserPerfil, setNovoUserPerfil] = useState('CAIXA');

  // CARREGAR DADOS INICIAIS
  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
      
      const uSalvos = await AsyncStorage.getItem('openmesa_usuarios');
      if (uSalvos) setUsuarios(JSON.parse(uSalvos));

      const pSalvos = await AsyncStorage.getItem('openmesa_pedidos_convenio');
      if (pSalvos) setPedidosConvenio(JSON.parse(pSalvos));

      await atualizarContadorPendentes();
    })();

    const unsubscribeNetInfo = NetInfo.addEventListener(state => {
      setModoContingencia(!state.isConnected || state.isInternetReachable === false);
    });

    return () => unsubscribeNetInfo();
  }, []);

  // BACKUP AUTOMÁTICO (30 MINUTOS)
  useEffect(() => {
    const executarBackupAutomatico = async () => {
      try {
        const keys = await AsyncStorage.getAllKeys();
        const chavesOpenMesa = keys.filter(k => k.startsWith('openmesa_') && k !== 'openmesa_backup_auto');
        const paresDados = await AsyncStorage.multiGet(chavesOpenMesa);

        const dadosParaBackup = {};
        paresDados.forEach(([chave, valor]) => {
          if (valor) dadosParaBackup[chave] = JSON.parse(valor);
        });

        const agora = new Date();
        await AsyncStorage.setItem('openmesa_backup_auto', JSON.stringify({
          dataHora: agora.toLocaleString('pt-BR'),
          registros: dadosParaBackup
        }));
        
        setUltimoBackup(agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
      } catch (error) {
        console.error('Erro no backup:', error);
      }
    };

    executarBackupAutomatico();
    const intervalId = setInterval(executarBackupAutomatico, INTERVALO_BACKUP_MS);
    return () => clearInterval(intervalId);
  }, []);

  // CHECAGEM DE PERMISSÃO
  const temPermissao = (chavePermissao) => {
    if (!usuarioLogado) return false;
    return usuarioLogado.permissoes ? usuarioLogado.permissoes.includes(chavePermissao) : false;
  };

  // LOGIN, CADASTRO E LOGOUT
  const realizarLogin = () => {
    setErroLogin('');
    const user = usuarioInput.trim().toLowerCase();

    if (!user && !senhaInput) {
      setErroLogin('Informe o usuário e a senha.');
      return;
    }
    if (!user) {
      setErroLogin('Por favor, digite seu usuário.');
      return;
    }
    if (!senhaInput) {
      setErroLogin('Por favor, digite sua senha.');
      return;
    }

    const conta = usuarios.find(u => u.usuario.toLowerCase() === user && u.senha === senhaInput);

    if (conta) {
      setUsuarioLogado(conta);
      setTelaAtual('tela_inicial');
      setUsuarioInput('');
      setSenhaInput('');
      setErroLogin('');
    } else {
      // ✅ Mensagem unificada de erro para maior segurança
      setErroLogin('Usuário/senha incorreto');
    }
  };

  const realizarCadastroTelaLogin = async () => {
    if (!novoNome || !novoUser || !novaSenha) {
      return Alert.alert("Atenção", "Preencha todos os campos obrigatórios.");
    }

    const userExiste = usuarios.some(u => u.usuario.toLowerCase() === novoUser.trim().toLowerCase());
    if (userExiste) {
      return Alert.alert("Erro", "Este nome de usuário já está cadastrado.");
    }

    let perfilAtribuido = 'EMPRESA';
    const chaveDigitada = chaveAcesso.trim();

    if (chaveDigitada === CHAVE_CAIXA) perfilAtribuido = 'CAIXA';
    else if (chaveDigitada === CHAVE_FISCAL) perfilAtribuido = 'FISCAL';
    else if (chaveDigitada === CHAVE_MESTRA_AUDITOR) perfilAtribuido = 'AUDITOR';
    else if (chaveDigitada !== '') {
      return Alert.alert("Chave Inválida", "Chave de funcionário incorreta. Deixe em branco se for Empresa.");
    }

    const novoUsuarioObj = {
      id: Date.now().toString(),
      nome: novoNome,
      usuario: novoUser.trim().toLowerCase(),
      senha: novaSenha,
      perfil: perfilAtribuido,
      permissoes: [...PERMISSOES_PADRAO[perfilAtribuido]]
    };

    const listaAtualizada = [...usuarios, novoUsuarioObj];
    setUsuarios(listaAtualizada);
    await AsyncStorage.setItem('openmesa_usuarios', JSON.stringify(listaAtualizada));

    Alert.alert("Sucesso", `Conta criada como ${perfilAtribuido}! Faça login para acessar.`);
    setModoCadastro(false);
    setNovoNome('');
    setNovoUser('');
    setNovaSenha('');
    setChaveAcesso('');
  };

  const realizarLogout = () => {
    setUsuarioLogado(null);
    setTelaAtual('tela_login');
  };

  // BANCO DE DADOS LOCAL
  const obterChaveData = (data) => {
    let d = String(data.getDate()).padStart(2, '0');
    let m = String(data.getMonth() + 1).padStart(2, '0');
    let a = data.getFullYear();
    return `openmesa_${a}_${m}_${d}`;
  };

  const buscarDadosData = async (data) => {
    const chave = obterChaveData(data);
    const dados = await AsyncStorage.getItem(chave);
    return dados ? JSON.parse(dados) : { refeicao: 0, marmita: 0, convenio: 0, pendentes: 0 };
  };

  const salvarDadosData = async (data, r, m, c = 0, pendentesAdicionais = 0) => {
    const chave = obterChaveData(data);
    const dadosAtuais = await buscarDadosData(data);
    
    const objeto = {
      refeicao: Number(r),
      marmita: Number(m),
      convenio: Number(c),
      pendentes: (dadosAtuais.pendentes || 0) + pendentesAdicionais
    };

    await AsyncStorage.setItem(chave, JSON.stringify(objeto));
    await atualizarContadorPendentes();
  };

  const somarDadosDiaAtual = async (addRefeicao, addMarmita, addConvenio = 0) => {
    const hoje = new Date();
    const atuais = await buscarDadosData(hoje);
    const totalNovasFichas = addRefeicao + addMarmita + addConvenio;
    const novasPendentes = modoContingencia ? totalNovasFichas : 0;

    await salvarDadosData(
      hoje, 
      (atuais.refeicao || 0) + addRefeicao, 
      (atuais.marmita || 0) + addMarmita, 
      (atuais.convenio || 0) + addConvenio,
      novasPendentes
    );
  };

  const atualizarContadorPendentes = async () => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      let totalPendentes = 0;
      for (const key of keys) {
        if (key.startsWith('openmesa_') && key !== 'openmesa_backup_auto') {
          const item = await AsyncStorage.getItem(key);
          if (item) totalPendentes += (JSON.parse(item).pendentes || 0);
        }
      }
      setQtdPendentes(totalPendentes);
    } catch (error) {
      console.error("Erro ao atualizar pendentes", error);
    }
  };

  const sincronizarContingencia = async () => {
    if (modoContingencia) {
      return Alert.alert("Sem Conexão", "Conecte-se à internet para realizar a sincronização.");
    }
    if (qtdPendentes === 0) {
      return Alert.alert("Sincronização", "Nenhum registro pendente.");
    }

    Alert.alert(
      "Sincronizar Dados",
      `Enviar ${qtdPendentes} registro(s) pendentes para o servidor?`,
      [
        {
          text: "Confirmar",
          onPress: async () => {
            const keys = await AsyncStorage.getAllKeys();
            for (const key of keys) {
              if (key.startsWith('openmesa_') && key !== 'openmesa_backup_auto') {
                const item = await AsyncStorage.getItem(key);
                if (item) {
                  const parsed = JSON.parse(item);
                  parsed.pendentes = 0;
                  await AsyncStorage.setItem(key, JSON.stringify(parsed));
                }
              }
            }
            await atualizarContadorPendentes();
            Alert.alert("Sucesso", "Dados sincronizados com sucesso!");
          }
        },
        { text: "Cancelar", style: "cancel" }
      ]
    );
  };

  // FLUXO DO PERFIL EMPRESA
  const enviarPedidoEmpresa = async () => {
    if (!nomeSolicitanteEmpresa || !nomeEmpresaPedido || !qtdMarmitasEmpresa) {
      return Alert.alert("Atenção", "Preencha todos os campos do pedido.");
    }

    const novoPedido = {
      id: Date.now().toString(),
      empresa: nomeEmpresaPedido,
      solicitante: nomeSolicitanteEmpresa,
      qtdMarmitas: parseInt(qtdMarmitasEmpresa) || 0,
      status: 'pendente',
      pago: false,
      dataHora: new Date().toLocaleString('pt-BR')
    };

    const atualizados = [...pedidosConvenio, novoPedido];
    setPedidosConvenio(atualizados);
    await AsyncStorage.setItem('openmesa_pedidos_convenio', JSON.stringify(atualizados));

    setNomeSolicitanteEmpresa('');
    setNomeEmpresaPedido('');
    setQtdMarmitasEmpresa('');
    setModalAtivo(null);
    Alert.alert("Sucesso", "Pedido enviado ao fiscal do restaurante!");
  };

  // FLUXO DO PERFIL FISCAL
  const salvarEdicaoPedidoConvenio = async (novoQtd) => {
    if (!pedidoSelecionadoDetalhe) return;
    const qtd = parseInt(novoQtd) || 0;

    const atualizados = pedidosConvenio.map(p => {
      if (p.id === pedidoSelecionadoDetalhe.id) {
        return { ...p, qtdMarmitas: qtd };
      }
      return p;
    });

    setPedidosConvenio(atualizados);
    setPedidoSelecionadoDetalhe({ ...pedidoSelecionadoDetalhe, qtdMarmitas: qtd });
    await AsyncStorage.setItem('openmesa_pedidos_convenio', JSON.stringify(atualizados));
  };

  const adicionarPedidoAContagem = async () => {
    if (!pedidoSelecionadoDetalhe) return;
    await somarDadosDiaAtual(0, 0, pedidoSelecionadoDetalhe.qtdMarmitas);

    const atualizados = pedidosConvenio.map(p => {
      if (p.id === pedidoSelecionadoDetalhe.id) {
        return { ...p, status: 'adicionado_contagem' };
      }
      return p;
    });

    setPedidosConvenio(atualizados);
    await AsyncStorage.setItem('openmesa_pedidos_convenio', JSON.stringify(atualizados));
    Alert.alert("Sucesso", `${pedidoSelecionadoDetalhe.qtdMarmitas} marmita(s) de convênio somadas ao histórico do dia!`);
  };

  const finalizarPedidoConvenio = async () => {
    if (!pedidoSelecionadoDetalhe) return;
    const valorTotalCalculado = pedidoSelecionadoDetalhe.qtdMarmitas * PRECO_FICHA;

    const atualizados = pedidosConvenio.map(p => {
      if (p.id === pedidoSelecionadoDetalhe.id) {
        return { ...p, status: 'finalizado', valorTotal: valorTotalCalculado };
      }
      return p;
    });

    setPedidosConvenio(atualizados);
    await AsyncStorage.setItem('openmesa_pedidos_convenio', JSON.stringify(atualizados));
    setModalAtivo('pop_marmitas_convenio');
    setPedidoSelecionadoDetalhe(null);
    Alert.alert("Pedido Finalizado", "Pedido movido para a tela de Pagamentos de Convênios.");
  };

  const alternarSelecaoPagamento = (id) => {
    if (pedidosSelecionadosPagamento.includes(id)) {
      setPedidosSelecionadosPagamento(pedidosSelecionadosPagamento.filter(item => item !== id));
    } else {
      setPedidosSelecionadosPagamento([...pedidosSelecionadosPagamento, id]);
    }
  };

  const marcarSelecionadosComoPago = async () => {
    if (pedidosSelecionadosPagamento.length === 0) {
      return Alert.alert("Atenção", "Selecione ao menos um pedido.");
    }

    const atualizados = pedidosConvenio.map(p => {
      if (pedidosSelecionadosPagamento.includes(p.id)) {
        return { ...p, pago: true };
      }
      return p;
    });

    setPedidosConvenio(atualizados);
    await AsyncStorage.setItem('openmesa_pedidos_convenio', JSON.stringify(atualizados));
    setPedidosSelecionadosPagamento([]);
    Alert.alert("Sucesso", "Pedidos selecionados marcados como pagos!");
  };

  // FUNÇÃO REAL DE GERAÇÃO DE RELATÓRIOS PARA EXCEL (CSV)
  const gerarRelatorioExcel = async (tipo) => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const keysData = keys.filter(k => /^openmesa_\d{4}_\d{2}_\d{2}$/.test(k));

      if (keysData.length === 0) {
        return Alert.alert("Atenção", "Não há dados para gerar a planilha.");
      }

      const hoje = new Date();
      let dadosFiltrados = [];

      let dtInicio = null;
      let dtFim = null;

      if (tipo === 'Personalizado') {
        if (!dataInicioRelatorio || !dataFimRelatorio) {
          return Alert.alert("Atenção", "Preencha as datas de início e fim no formato DD/MM/AAAA.");
        }
        const [dI, mI, aI] = dataInicioRelatorio.split('/').map(Number);
        const [dF, mF, aF] = dataFimRelatorio.split('/').map(Number);

        if (!dI || !mI || !aI || !dF || !mF || !aF) {
          return Alert.alert("Atenção", "Formato de data inválido. Use DD/MM/AAAA.");
        }

        dtInicio = new Date(aI, mI - 1, dI, 0, 0, 0);
        dtFim = new Date(aF, mF - 1, dF, 23, 59, 59);
      }

      for (const key of keysData) {
        const [, ano, mes, dia] = key.split('_');
        const dataItem = new Date(parseInt(ano), parseInt(mes) - 1, parseInt(dia));
        const itemRaw = await AsyncStorage.getItem(key);
        if (!itemRaw) continue;

        const parsed = JSON.parse(itemRaw);
        const totalFichas = (parsed.refeicao || 0) + (parsed.marmita || 0) + (parsed.convenio || 0);

        if (totalFichas === 0) continue;

        let incluir = false;

        if (tipo === 'Diário') {
          incluir = ehHoje(dataItem);
        } else if (tipo === 'Semanal') {
          const inicioSemana = new Date(hoje);
          inicioSemana.setDate(hoje.getDate() - 7);
          incluir = dataItem >= inicioSemana && dataItem <= hoje;
        } else if (tipo === 'Mensal') {
          incluir = dataItem.getMonth() === hoje.getMonth() && dataItem.getFullYear() === hoje.getFullYear();
        } else if (tipo === 'Anual') {
          incluir = dataItem.getFullYear() === hoje.getFullYear();
        } else if (tipo === 'Personalizado') {
          incluir = dataItem >= dtInicio && dataItem <= dtFim;
        }

        if (incluir) {
          dadosFiltrados.push({
            dataStr: `${dia}/${mes}/${ano}`,
            dataObj: dataItem,
            refeicao: parsed.refeicao || 0,
            marmita: parsed.marmita || 0,
            convenio: parsed.convenio || 0,
            totalFichas,
            valorTotal: totalFichas * PRECO_FICHA
          });
        }
      }

      if (dadosFiltrados.length === 0) {
        return Alert.alert("Atenção", "Não há dados para gerar a planilha dentro do filtro selecionado.");
      }

      dadosFiltrados.sort((a, b) => a.dataObj - b.dataObj);

      let csvContent = '\uFEFFData;Refeições;Marmitas;Convênio;Total Fichas;Valor Total (R$)\n';
      let totRef = 0, totMar = 0, totConv = 0, totFichas = 0, totValor = 0;

      dadosFiltrados.forEach(row => {
        csvContent += `${row.dataStr};${row.refeicao};${row.marmita};${row.convenio};${row.totalFichas};R$ ${row.valorTotal.toFixed(2).replace('.', ',')}\n`;
        totRef += row.refeicao;
        totMar += row.marmita;
        totConv += row.convenio;
        totFichas += row.totalFichas;
        totValor += row.valorTotal;
      });

      csvContent += `TOTAL;${totRef};${totMar};${totConv};${totFichas};R$ ${totValor.toFixed(2).replace('.', ',')}\n`;

      const filename = `Relatorio_${tipo}_${Date.now()}.csv`;
      const fileUri = FileSystem.documentDirectory + filename;

      await FileSystem.writeAsStringAsync(fileUri, csvContent, { encoding: FileSystem.EncodingType.UTF8 });

      setModalAtivo(null);
      setDataInicioRelatorio('');
      setDataFimRelatorio('');

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'text/csv',
          dialogTitle: `Exportar Relatório ${tipo}`,
          UTI: 'public.comma-separated-values-text'
        });
      } else {
        Alert.alert("Sucesso", `Relatório salvo em: ${fileUri}`);
      }

    } catch (error) {
      console.error("Erro ao gerar relatório:", error);
      Alert.alert("Erro", "Falha ao gerar o relatório.");
    }
  };

  // FLUXO DO AUDITOR (USUÁRIOS E PERMISSÕES)
  const criarNovoUsuario = async () => {
    if (!novoUserNome || !novoUserUsuario || !novoUserSenha) {
      return Alert.alert("Atenção", "Preencha os campos obrigatórios.");
    }

    const novo = {
      id: Date.now().toString(),
      nome: novoUserNome,
      usuario: novoUserUsuario.trim().toLowerCase(),
      senha: novoUserSenha,
      perfil: novoUserPerfil,
      permissoes: [...PERMISSOES_PADRAO[novoUserPerfil]]
    };

    const atualizada = [...usuarios, novo];
    setUsuarios(atualizada);
    await AsyncStorage.setItem('openmesa_usuarios', JSON.stringify(atualizada));

    setNovoUserNome('');
    setNovoUserUsuario('');
    setNovoUserSenha('');
    Alert.alert("Sucesso", "Novo usuário cadastrado!");
  };

  const excluirUsuario = async (id) => {
    if (usuarios.length <= 1) return Alert.alert("Erro", "Não é possível excluir o único usuário.");
    const atualizada = usuarios.filter(u => u.id !== id);
    setUsuarios(atualizada);
    await AsyncStorage.setItem('openmesa_usuarios', JSON.stringify(atualizada));
  };

  const alternarPermissaoUsuario = async (userId, permissao) => {
    const atualizada = usuarios.map(u => {
      if (u.id === userId) {
        const jaTem = u.permissoes.includes(permissao);
        const novasPerms = jaTem ? u.permissoes.filter(p => p !== permissao) : [...u.permissoes, permissao];
        return { ...u, permissoes: novasPerms };
      }
      return u;
    });

    setUsuarios(atualizada);
    await AsyncStorage.setItem('openmesa_usuarios', JSON.stringify(atualizada));
  };

  // SCANNER & FLUXOS MANUAIS
  const handleBarCodeScanned = ({ data }) => {
    if (scanned) return;
    setScanned(true);

    if (data === "OPENMESA_MARMITA") setScanCounts(prev => ({ ...prev, marmita: prev.marmita + 1 }));
    else if (data === "OPENMESA_REFEICAO") setScanCounts(prev => ({ ...prev, refeicao: prev.refeicao + 1 }));

    setTimeout(() => setScanned(false), 1500);
  };

  const confirmarScanner = async () => {
    if (scanCounts.marmita === 0 && scanCounts.refeicao === 0) return Alert.alert("Atenção", "Nenhum código lido.");
    await somarDadosDiaAtual(scanCounts.refeicao, scanCounts.marmita, 0);
    setTelaAtual('tela_inicial');
    setModalAtivo('pop_sucesso');
  };

  const confirmarFichasPopUp = () => {
    const m = parseInt(qtdMarmitas) || 0;
    const r = parseInt(qtdRefeicoes) || 0;
    if (m + r === 0) return Alert.alert("Atenção", "Insira um valor.");
    setModalAtivo('pop_confirmacao');
  };

  const avancarParaSucesso = async () => {
    const m = parseInt(qtdMarmitas) || 0;
    const r = parseInt(qtdRefeicoes) || 0;
    await somarDadosDiaAtual(r, m, 0);
    setModalAtivo('pop_sucesso');
  };

  const abrirRegistroData = async (dataSelecionada) => {
    setDataRegistro(dataSelecionada);
    const dados = await buscarDadosData(dataSelecionada);
    setRegistroDia({
      refeicao: dados.refeicao || 0,
      marmita: dados.marmita || 0,
      convenio: dados.convenio || 0,
      pendentes: dados.pendentes || 0
    });
    setModalAtivo('pop_registro_detalhes');
  };

  const navegarDataRegistro = async (dias) => {
    const novaData = new Date(dataRegistro);
    novaData.setDate(novaData.getDate() + dias);
    await abrirRegistroData(novaData);
  };

  const alterarQtdRegistro = async (tipo, valor) => {
    const novoValor = parseInt(valor) || 0;
    const novoRegistro = { ...registroDia, [tipo]: novoValor };
    setRegistroDia(novoRegistro);
    await salvarDadosData(
      dataRegistro, 
      novoRegistro.refeicao || 0, 
      novoRegistro.marmita || 0, 
      novoRegistro.convenio || 0
    );
  };

  const ehHoje = (data) => {
    const hoje = new Date();
    return data.getDate() === hoje.getDate() &&
           data.getMonth() === hoje.getMonth() &&
           data.getFullYear() === hoje.getFullYear();
  };

  const renderDiasCalendario = () => {
    const ano = dataCalendario.getFullYear();
    const mes = dataCalendario.getMonth();
    const primeiroDia = new Date(ano, mes, 1).getDay();
    const totalDias = new Date(ano, mes + 1, 0).getDate();

    let celulas = [];
    for (let i = 0; i < primeiroDia; i++) celulas.push(<View key={`empty-${i}`} style={styles.diaVazio} />);

    for (let i = 1; i <= totalDias; i++) {
      const dataCelula = new Date(ano, mes, i);
      const destaqueHoje = ehHoje(dataCelula);
      celulas.push(
        <TouchableOpacity key={`dia-${i}`} style={[styles.dia, destaqueHoje && styles.diaHoje]} onPress={() => abrirRegistroData(dataCelula)}>
          <Text style={[styles.diaTexto, destaqueHoje && styles.diaHojeTexto]}>{i}</Text>
        </TouchableOpacity>
      );
    }
    return celulas;
  };

  // CÁLCULO DE PAGAMENTOS
  const totalSelecionadoPagamento = pedidosConvenio
    .filter(p => pedidosSelecionadosPagamento.includes(p.id))
    .reduce((acc, curr) => acc + (curr.valorTotal || (curr.qtdMarmitas * PRECO_FICHA)), 0);

  // TELA DE LOGIN / CADASTRO
  if (telaAtual === 'tela_login') {
    return (
      <View style={styles.container}>
        <View style={styles.logo}><Text style={styles.logoText}>Open{'\n'}Mesa</Text></View>
        
        {!modoCadastro ? (
          <>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Usuário:</Text>
              <TextInput 
                style={styles.input} 
                value={usuarioInput} 
                onChangeText={(t) => { setUsuarioInput(t); setErroLogin(''); }} 
                autoCapitalize="none" 
              />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Digite sua senha:</Text>
              <TextInput 
                style={styles.input} 
                secureTextEntry 
                value={senhaInput} 
                onChangeText={(t) => { setSenhaInput(t); setErroLogin(''); }} 
              />
            </View>

            {erroLogin ? (
              <Text style={styles.erroTexto}>{erroLogin}</Text>
            ) : null}

            <TouchableOpacity style={[styles.btnPrincipal, { width: '60%', marginTop: 10 }]} onPress={realizarLogin}>
              <Text style={styles.btnText}>Login</Text>
            </TouchableOpacity>

            <TouchableOpacity style={{ marginTop: 20 }} onPress={() => { setModoCadastro(true); setErroLogin(''); }}>
              <Text style={{ color: '#1a73e8', fontWeight: 'bold' }}>Não tem uma conta? Cadastre-se</Text>
            </TouchableOpacity>
          </>
        ) : (
          <ScrollView style={{ width: '100%' }} contentContainerStyle={{ alignItems: 'center' }}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Nome ou Razão Social:</Text>
              <TextInput style={styles.input} value={novoNome} onChangeText={setNovoNome} />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Usuário para login:</Text>
              <TextInput style={styles.input} value={novoUser} onChangeText={setNovoUser} autoCapitalize="none" />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Senha:</Text>
              <TextInput style={styles.input} secureTextEntry value={novaSenha} onChangeText={setNovaSenha} />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Chave de Acesso Funcionário (Opcional):</Text>
              <TextInput style={styles.input} value={chaveAcesso} onChangeText={setChaveAcesso} placeholder="Deixe em branco se for Empresa" autoCapitalize="characters" />
            </View>

            <TouchableOpacity style={[styles.btnPrincipal, { width: '60%', marginTop: 10 }]} onPress={realizarCadastroTelaLogin}>
              <Text style={styles.btnText}>Criar Conta</Text>
            </TouchableOpacity>

            <TouchableOpacity style={{ marginTop: 15, marginBottom: 20 }} onPress={() => setModoCadastro(false)}>
              <Text style={{ color: '#d93025', fontWeight: 'bold' }}>Voltar para o Login</Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>
    );
  }

  // TELA SCANNER
  if (telaAtual === 'tela_scanner') {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <TouchableOpacity style={styles.voltarBtnAbsoluto} onPress={() => setTelaAtual('tela_inicial')}>
          <Text style={{ color: 'white', fontSize: 24 }}>←</Text>
        </TouchableOpacity>

        {hasPermission ? (
          <CameraView style={{ height: '60%', width: '100%' }} onBarcodeScanned={scanned ? undefined : handleBarCodeScanned} />
        ) : (
          <View style={styles.container}><Text style={{ color: 'white' }}>Sem permissão de câmera</Text></View>
        )}

        <View style={styles.scannerFooter}>
          <View style={styles.scannerCounts}>
            <View style={styles.countBox}><Text style={styles.countLabel}>Marmita</Text><Text style={styles.countValue}>{scanCounts.marmita}</Text></View>
            <View style={styles.countBox}><Text style={styles.countLabel}>Refeição</Text><Text style={styles.countValue}>{scanCounts.refeicao}</Text></View>
          </View>
          <TouchableOpacity style={styles.btnPrincipal} onPress={confirmarScanner}><Text style={styles.btnText}>Confirmar</Text></TouchableOpacity>
        </View>
      </View>
    );
  }

  // TELA PRINCIPAL
  return (
    <View style={styles.container}>
      {modoContingencia && (
        <View style={styles.bannerContingencia}>
          <Text style={styles.bannerContingenciaTexto}>⚠️ SEM CONEXÃO: CONTINGÊNCIA ATIVA</Text>
        </View>
      )}

      <TouchableOpacity style={styles.voltarBtn} onPress={realizarLogout}>
        <Text style={{ fontSize: 14, color: '#d93025', fontWeight: 'bold' }}>🚪 Sair ({usuarioLogado?.perfil})</Text>
      </TouchableOpacity>
      
      <View style={[styles.logo, { marginTop: modoContingencia ? 10 : 0 }]}><Text style={styles.logoText}>Open{'\n'}Mesa</Text></View>
      <Text style={styles.bemVindoTexto}>Olá, {usuarioLogado?.nome}</Text>

      {/* PAINEL DE BACKUP/REDES */}
      {(usuarioLogado?.perfil === 'FISCAL' || usuarioLogado?.perfil === 'AUDITOR') && (
        <View style={styles.cardStatus}>
          <View style={styles.statusLinha}>
            <Text style={styles.statusLabel}>Rede:</Text>
            <Text style={[styles.statusValor, { color: modoContingencia ? '#d93025' : '#1e8e3e' }]}>
              {modoContingencia ? '● Offline (Contingência)' : '● Online'}
            </Text>
          </View>
          {ultimoBackup && <Text style={styles.backupTexto}>💾 Último backup: {ultimoBackup}</Text>}
        </View>
      )}

      {/* PAINEL DE SINCRONIZAÇÃO */}
      {temPermissao('sync_backup') && qtdPendentes > 0 && (
        <TouchableOpacity style={styles.cardSync} onPress={sincronizarContingencia}>
          <Text style={styles.cardSyncTexto}>🔄 {qtdPendentes} ficha(s) salvas localmente</Text>
          <Text style={styles.cardSyncSubtexto}>Toque para sincronizar em tempo real</Text>
        </TouchableOpacity>
      )}

      {/* MENU - EMPRESA */}
      {usuarioLogado?.perfil === 'EMPRESA' && (
        <>
          <TouchableOpacity 
            style={styles.btnMenu} 
            onPress={() => {
              setNomeEmpresaPedido(usuarioLogado?.nome || '');
              setModalAtivo('pop_fazer_pedido_empresa');
            }}
          >
            <Text style={styles.btnText}>Fazer Pedido de Marmitas</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.btnMenu, { backgroundColor: '#1a2942' }]} 
            onPress={() => setModalAtivo('pop_meus_pedidos_empresa')}
          > 
            <Text style={styles.btnText}>Meus Pedidos Realizados</Text>
          </TouchableOpacity>
        </>
      )}

      {/* MENU - CAIXA */}
      {usuarioLogado?.perfil === 'CAIXA' && (
        <>
          {temPermissao('add_fichas') && (
            <TouchableOpacity style={styles.btnMenu} onPress={() => setModalAtivo('pop_fichas')}>
              <Text style={styles.btnText}>Adicionar Fichas</Text>
            </TouchableOpacity>
          )}

          {temPermissao('qr_code') && (
            <TouchableOpacity style={[styles.btnMenu, { backgroundColor: '#1a73e8' }]} onPress={() => setTelaAtual('tela_scanner')}>
              <Text style={styles.btnText}>Escanear QR Code</Text>
            </TouchableOpacity>
          )}

          {temPermissao('ver_historico') && (
            <TouchableOpacity style={[styles.btnMenu, { backgroundColor: '#5f6368' }]} onPress={() => setModalAtivo('pop_historico')}>
              <Text style={styles.btnText}>Histórico de Contagens</Text>
            </TouchableOpacity>
          )}
        </>
      )}

      {/* MENU - FISCAL */}
      {usuarioLogado?.perfil === 'FISCAL' && (
        <>
          {temPermissao('marmitas_convenio') && (
            <TouchableOpacity style={styles.btnMenu} onPress={() => setModalAtivo('pop_marmitas_convenio')}>
              <Text style={styles.btnText}>Marmitas de Convênio</Text>
            </TouchableOpacity>
          )}

          {temPermissao('pagamentos_convenio') && (
            <TouchableOpacity style={[styles.btnMenu, { backgroundColor: '#1e8e3e' }]} onPress={() => setModalAtivo('pop_pagamentos_convenio')}>
              <Text style={styles.btnText}>Pagamentos de Convênio</Text>
            </TouchableOpacity>
          )}

          {temPermissao('relatorios') && (
            <TouchableOpacity style={[styles.btnMenu, { backgroundColor: '#f2994a' }]} onPress={() => setModalAtivo('pop_relatorios')}>
              <Text style={styles.btnText}>Gerar Relatórios</Text>
            </TouchableOpacity>
          )}

          {temPermissao('ver_historico') && (
            <TouchableOpacity style={[styles.btnMenu, { backgroundColor: '#5f6368' }]} onPress={() => setModalAtivo('pop_historico')}>
              <Text style={styles.btnText}>Histórico</Text>
            </TouchableOpacity>
          )}
        </>
      )}

      {/* MENU - AUDITOR */}
      {usuarioLogado?.perfil === 'AUDITOR' && (
        <>
          {temPermissao('ver_historico') && (
            <TouchableOpacity style={styles.btnMenu} onPress={() => setModalAtivo('pop_historico')}>
              <Text style={styles.btnText}>Histórico Geral e Retroativo</Text>
            </TouchableOpacity>
          )}

          {temPermissao('gestao_usuarios') && (
            <TouchableOpacity style={[styles.btnMenu, { backgroundColor: '#8e24aa' }]} onPress={() => setModalAtivo('pop_gestao_usuarios')}>
              <Text style={styles.btnText}>Gestão de Usuários e Permissões</Text>
            </TouchableOpacity>
          )}
        </>
      )}

      {/* MODAIS DO SISTEMA */}

      {/* MODAL - PEDIDO EMPRESA */}
      <Modal visible={modalAtivo === 'pop_fazer_pedido_empresa'} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitulo}>Novo Pedido de Marmita</Text>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Empresa Solicitante:</Text>
              <TextInput style={styles.input} value={nomeEmpresaPedido} onChangeText={setNomeEmpresaPedido} />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Nome do Responsável:</Text>
              <TextInput style={styles.input} value={nomeSolicitanteEmpresa} onChangeText={setNomeSolicitanteEmpresa} />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Quantidade de Marmitas:</Text>
              <TextInput style={styles.input} keyboardType="numeric" value={qtdMarmitasEmpresa} onChangeText={setQtdMarmitasEmpresa} />
            </View>
            <TouchableOpacity style={styles.btnPrincipal} onPress={enviarPedidoEmpresa}>
              <Text style={styles.btnText}>Enviar Pedido</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnFechar} onPress={() => setModalAtivo(null)}>
              <Text style={{ color: '#666' }}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL - MEUS PEDIDOS EMPRESA */}
      <Modal visible={modalAtivo === 'pop_meus_pedidos_empresa'} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitulo}>Meus Pedidos Realizados</Text>
            <ScrollView style={{ maxHeight: 300, width: '100%' }}>
              {pedidosConvenio
                .filter(p => p.empresa.toLowerCase() === usuarioLogado?.nome.toLowerCase() || p.solicitante.toLowerCase() === usuarioLogado?.nome.toLowerCase())
                .map(p => (
                  <View key={p.id} style={styles.itemPedido}>
                    <Text style={styles.itemPedidoTexto}>📦 {p.qtdMarmitas} Marmitas - {p.dataHora}</Text>
                    <Text style={{ fontSize: 12, color: p.pago ? '#1e8e3e' : '#d93025' }}>
                      Status: {p.status} | {p.pago ? 'Pago' : 'Pendente de Pagamento'}
                    </Text>
                  </View>
                ))}
            </ScrollView>
            <TouchableOpacity style={styles.btnFechar} onPress={() => setModalAtivo(null)}>
              <Text style={{ color: '#666' }}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL - ADICIONAR FICHAS (MANUAL CAIXA) */}
      <Modal visible={modalAtivo === 'pop_fichas'} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitulo}>Adicionar Fichas</Text>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Marmitas:</Text>
              <TextInput style={styles.input} keyboardType="numeric" value={qtdMarmitas} onChangeText={setQtdMarmitas} />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Refeições Presenciais:</Text>
              <TextInput style={styles.input} keyboardType="numeric" value={qtdRefeicoes} onChangeText={setQtdRefeicoes} />
            </View>
            <TouchableOpacity style={styles.btnPrincipal} onPress={confirmarFichasPopUp}>
              <Text style={styles.btnText}>Avançar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnFechar} onPress={() => setModalAtivo(null)}>
              <Text style={{ color: '#666' }}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL - CONFIRMAÇÃO */}
      <Modal visible={modalAtivo === 'pop_confirmacao'} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitulo}>Confirmar Registro</Text>
            <Text style={{ fontSize: 16, marginBottom: 15, textAlign: 'center' }}>
              Marmitas: {qtdMarmitas || 0}{'\n'}
              Refeições: {qtdRefeicoes || 0}
            </Text>
            <TouchableOpacity style={styles.btnPrincipal} onPress={avançarParaSucesso}>
              <Text style={styles.btnText}>Confirmar e Salvar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnFechar} onPress={() => setModalAtivo('pop_fichas')}>
              <Text style={{ color: '#666' }}>Voltar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL - SUCESSO */}
      <Modal visible={modalAtivo === 'pop_sucesso'} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={[styles.modalTitulo, { color: '#1e8e3e' }]}>✅ Sucesso!</Text>
            <Text style={{ fontSize: 15, textAlign: 'center', marginBottom: 20 }}>
              {modoContingencia ? "Contagem salva em MODO CONTINGÊNCIA (Local)." : "Contagem registrada no sistema com sucesso!"}
            </Text>
            <TouchableOpacity style={styles.btnPrincipal} onPress={() => { setModalAtivo(null); setQtdMarmitas(''); setQtdRefeicoes(''); }}>
              <Text style={styles.btnText}>Ok</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL - MARMITAS DE CONVÊNIO (FISCAL) */}
      <Modal visible={modalAtivo === 'pop_marmitas_convenio'} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitulo}>Pedidos de Convênio</Text>
            <ScrollView style={{ maxHeight: 300, width: '100%' }}>
              {pedidosConvenio.filter(p => p.status !== 'finalizado').map(p => (
                <TouchableOpacity 
                  key={p.id} 
                  style={styles.itemPedido} 
                  onPress={() => { setPedidoSelecionadoDetalhe(p); setModalAtivo('pop_detalhe_pedido_convenio'); }}
                >
                  <Text style={styles.itemPedidoTexto}>🏢 {p.empresa}</Text>
                  <Text style={{ fontSize: 12, color: '#666' }}>Solicitante: {p.solicitante} | Qtd: {p.qtdMarmitas}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.btnFechar} onPress={() => setModalAtivo(null)}>
              <Text style={{ color: '#666' }}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL - DETALHE PEDIDO CONVÊNIO */}
      <Modal visible={modalAtivo === 'pop_detalhe_pedido_convenio'} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitulo}>Detalhes do Pedido</Text>
            {pedidoSelecionadoDetalhe && (
              <>
                <Text style={{ fontSize: 14, marginBottom: 5 }}>Empresa: {pedidoSelecionadoDetalhe.empresa}</Text>
                <Text style={{ fontSize: 14, marginBottom: 15 }}>Solicitante: {pedidoSelecionadoDetalhe.solicitante}</Text>
                
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Editar Qtd Marmitas:</Text>
                  <TextInput 
                    style={styles.input} 
                    keyboardType="numeric" 
                    value={String(pedidoSelecionadoDetalhe.qtdMarmitas)} 
                    onChangeText={salvarEdicaoPedidoConvenio} 
                  />
                </View>

                <TouchableOpacity style={[styles.btnPrincipal, { backgroundColor: '#1a73e8' }]} onPress={adicionarPedidoAContagem}>
                  <Text style={styles.btnText}>Somar ao Histórico do Dia</Text>
                </TouchableOpacity>

                <TouchableOpacity style={[styles.btnPrincipal, { backgroundColor: '#1e8e3e', marginTop: 10 }]} onPress={finalizarPedidoConvenio}>
                  <Text style={styles.btnText}>Mover para Pagamentos</Text>
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity style={styles.btnFechar} onPress={() => setModalAtivo('pop_marmitas_convenio')}>
              <Text style={{ color: '#666' }}>Voltar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL - PAGAMENTOS DE CONVÊNIO */}
      <Modal visible={modalAtivo === 'pop_pagamentos_convenio'} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitulo}>Pagamentos de Convênio</Text>
            <ScrollView style={{ maxHeight: 250, width: '100%' }}>
              {pedidosConvenio.filter(p => p.status === 'finalizado').map(p => {
                const selecionado = pedidosSelecionadosPagamento.includes(p.id);
                return (
                  <TouchableOpacity 
                    key={p.id} 
                    style={[styles.itemPedido, selecionado && { backgroundColor: '#e8f0fe', borderColor: '#1a73e8', borderWidth: 1 }]} 
                    onPress={() => alternarSelecaoPagamento(p.id)}
                  >
                    <Text style={styles.itemPedidoTexto}>{selecionado ? '☑️' : '☐'} {p.empresa} - R$ {(p.valorTotal || p.qtdMarmitas * PRECO_FICHA).toFixed(2)}</Text>
                    <Text style={{ fontSize: 12, color: p.pago ? '#1e8e3e' : '#d93025' }}>
                      {p.pago ? 'Pago' : 'Pendente de Pagamento'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text style={{ fontWeight: 'bold', marginVertical: 10 }}>Total Selecionado: R$ {totalSelecionadoPagamento.toFixed(2)}</Text>

            <TouchableOpacity style={[styles.btnPrincipal, { backgroundColor: '#1e8e3e' }]} onPress={marcarSelecionadosComoPago}>
              <Text style={styles.btnText}>Marcar Selecionados como Pago</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.btnFechar} onPress={() => setModalAtivo(null)}>
              <Text style={{ color: '#666' }}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL - RELATÓRIOS EXCEL */}
      <Modal visible={modalAtivo === 'pop_relatorios'} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitulo}>Exportar para Excel (CSV)</Text>
            
            <TouchableOpacity style={styles.btnMenu} onPress={() => gerarRelatorioExcel('Diário')}>
              <Text style={styles.btnText}>Relatório Diário</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.btnMenu} onPress={() => gerarRelatorioExcel('Semanal')}>
              <Text style={styles.btnText}>Relatório Semanal</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.btnMenu} onPress={() => gerarRelatorioExcel('Mensal')}>
              <Text style={styles.btnText}>Relatório Mensal</Text>
            </TouchableOpacity>

            <View style={{ width: '100%', borderTopWidth: 1, borderColor: '#ddd', paddingTop: 10, marginTop: 5 }}>
              <Text style={styles.label}>Período Personalizado:</Text>
              <TextInput style={styles.input} placeholder="Início: DD/MM/AAAA" value={dataInicioRelatorio} onChangeText={setDataInicioRelatorio} />
              <TextInput style={styles.input} placeholder="Fim: DD/MM/AAAA" value={dataFimRelatorio} onChangeText={setDataFimRelatorio} />
              <TouchableOpacity style={[styles.btnPrincipal, { backgroundColor: '#1a73e8' }]} onPress={() => gerarRelatorioExcel('Personalizado')}>
                <Text style={styles.btnText}>Gerar Personalizado</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.btnFechar} onPress={() => setModalAtivo(null)}>
              <Text style={{ color: '#666' }}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL - HISTÓRICO DE CONTAGENS */}
      <Modal visible={modalAtivo === 'pop_historico'} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitulo}>Calendário de Contagens</Text>
            <View style={styles.calendarioHeader}>
              <TouchableOpacity onPress={() => setDataCalendario(new Date(dataCalendario.getFullYear(), dataCalendario.getMonth() - 1, 1))}>
                <Text style={{ fontSize: 20, paddingHorizontal: 10 }}>◄</Text>
              </TouchableOpacity>
              <Text style={{ fontWeight: 'bold', fontSize: 16 }}>{MESES[dataCalendario.getMonth()]} / {dataCalendario.getFullYear()}</Text>
              <TouchableOpacity onPress={() => setDataCalendario(new Date(dataCalendario.getFullYear(), dataCalendario.getMonth() + 1, 1))}>
                <Text style={{ fontSize: 20, paddingHorizontal: 10 }}>►</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.calendarioGrid}>
              {renderDiasCalendario()}
            </View>

            <TouchableOpacity style={styles.btnFechar} onPress={() => setModalAtivo(null)}>
              <Text style={{ color: '#666' }}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL - REGISTRO DETALHADO DO DIA (COM NAVEGAÇÃO E EDIÇÃO RETROATIVA) */}
      <Modal visible={modalAtivo === 'pop_registro_detalhes'} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginBottom: 15 }}>
              <TouchableOpacity onPress={() => navegarDataRegistro(-1)}>
                <Text style={{ fontSize: 22, color: '#1a73e8' }}>◄ Dia anterior</Text>
              </TouchableOpacity>
              <Text style={{ fontWeight: 'bold', fontSize: 16 }}>
                {dataRegistro.getDate()}/{dataRegistro.getMonth() + 1}/{dataRegistro.getFullYear()}
              </Text>
              <TouchableOpacity onPress={() => navegarDataRegistro(1)}>
                <Text style={{ fontSize: 22, color: '#1a73e8' }}>Próximo dia ►</Text>
              </TouchableOpacity>
            </View>

            {temPermissao('editar_retroativo') || (temPermissao('editar_historico') && ehHoje(dataRegistro)) ? (
              <>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Refeições Presenciais:</Text>
                  <TextInput 
                    style={styles.input} 
                    keyboardType="numeric" 
                    value={String(registroDia.refeicao)} 
                    onChangeText={(val) => alterarQtdRegistro('refeicao', val)} 
                  />
                </View>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Marmitas Individuais:</Text>
                  <TextInput 
                    style={styles.input} 
                    keyboardType="numeric" 
                    value={String(registroDia.marmita)} 
                    onChangeText={(val) => alterarQtdRegistro('marmita', val)} 
                  />
                </View>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Marmitas de Convênio:</Text>
                  <TextInput 
                    style={styles.input} 
                    keyboardType="numeric" 
                    value={String(registroDia.convenio)} 
                    onChangeText={(val) => alterarQtdRegistro('convenio', val)} 
                  />
                </View>
              </>
            ) : (
              <View style={{ width: '100%', marginVertical: 10 }}>
                <Text style={{ fontSize: 15, marginBottom: 5 }}>Refeições Presenciais: {registroDia.refeicao}</Text>
                <Text style={{ fontSize: 15, marginBottom: 5 }}>Marmitas Individuais: {registroDia.marmita}</Text>
                <Text style={{ fontSize: 15, marginBottom: 5 }}>Marmitas de Convênio: {registroDia.convenio}</Text>
              </View>
            )}

            <Text style={{ fontWeight: 'bold', fontSize: 16, marginTop: 10 }}>
              Total de Fichas: {(registroDia.refeicao || 0) + (registroDia.marmita || 0) + (registroDia.convenio || 0)}
            </Text>

            <TouchableOpacity style={styles.btnFechar} onPress={() => setModalAtivo('pop_historico')}>
              <Text style={{ color: '#666' }}>Voltar ao Calendário</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL - GESTÃO DE USUÁRIOS E PERMISSÕES (AUDITOR) */}
      <Modal visible={modalAtivo === 'pop_gestao_usuarios'} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitulo}>Gestão de Usuários</Text>
            <ScrollView style={{ maxHeight: 350, width: '100%' }}>
              <Text style={[styles.label, { fontWeight: 'bold', marginTop: 5 }]}>Cadastrar Novo Usuário:</Text>
              <TextInput style={styles.input} placeholder="Nome" value={novoUserNome} onChangeText={setNovoUserNome} />
              <TextInput style={styles.input} placeholder="Usuário" value={novoUserUsuario} onChangeText={setNovoUserUsuario} autoCapitalize="none" />
              <TextInput style={styles.input} placeholder="Senha" value={novoUserSenha} onChangeText={setNovoUserSenha} />
              
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                {['CAIXA', 'FISCAL', 'AUDITOR', 'EMPRESA'].map(p => (
                  <TouchableOpacity 
                    key={p} 
                    style={[styles.btnFechar, novoUserPerfil === p && { backgroundColor: '#1a73e8', color: '#fff' }]} 
                    onPress={() => setNovoUserPerfil(p)}
                  >
                    <Text style={{ color: novoUserPerfil === p ? '#fff' : '#333', fontSize: 10 }}>{p}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity style={styles.btnPrincipal} onPress={criarNovoUsuario}>
                <Text style={styles.btnText}>Cadastrar Usuário</Text>
              </TouchableOpacity>

              <Text style={[styles.label, { fontWeight: 'bold', marginTop: 20 }]}>Usuários e Permissões Ativas:</Text>
              {usuarios.map(u => (
                <View key={u.id} style={[styles.itemPedido, { flexDirection: 'column', alignItems: 'flex-start' }]}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
                    <Text style={{ fontWeight: 'bold' }}>{u.nome} ({u.perfil})</Text>
                    <TouchableOpacity onPress={() => excluirUsuario(u.id)}>
                      <Text style={{ color: '#d93025' }}>Excluir</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={{ fontSize: 12, color: '#666' }}>User: {u.usuario} | Senha: {u.senha}</Text>
                  <Text style={{ fontSize: 11, color: '#444', marginTop: 4 }}>Permissões:</Text>
                  
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 }}>
                    {Object.keys(PERMISSOES_PADRAO).map(key => PERMISSOES_PADRAO[key]).flat().reduce((acc, current) => {
                      if (!acc.includes(current)) acc.push(current);
                      return acc;
                    }, []).map(perm => {
                      const tem = u.permissoes ? u.permissoes.includes(perm) : false;
                      return (
                        <TouchableOpacity 
                          key={perm} 
                          style={{ backgroundColor: tem ? '#e8f0fe' : '#f1f3f4', padding: 4, borderRadius: 4, marginRight: 4, marginBottom: 4 }}
                          onPress={() => alternarPermissaoUsuario(u.id, perm)}
                        >
                          <Text style={{ fontSize: 10, color: tem ? '#1a73e8' : '#888' }}>{tem ? '✓' : '✗'} {perm}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}
            </ScrollView>

            <TouchableOpacity style={styles.btnFechar} onPress={() => setModalAtivo(null)}>
              <Text style={{ color: '#666' }}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  logo: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#1a2942',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  logoText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  bemVindoTexto: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
  },
  inputGroup: {
    width: '100%',
    marginBottom: 12,
  },
  label: {
    fontSize: 14,
    color: '#333',
    marginBottom: 5,
  },
  input: {
    width: '100%',
    height: 45,
    borderColor: '#ccc',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  erroTexto: {
    color: '#d93025',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  btnPrincipal: {
    width: '100%',
    height: 48,
    backgroundColor: '#1e8e3e',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    marginTop: 10,
  },
  btnMenu: {
    width: '100%',
    height: 52,
    backgroundColor: '#1a2942',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    marginBottom: 12,
  },
  btnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  voltarBtn: {
    position: 'absolute',
    top: 45,
    right: 20,
    zIndex: 10,
  },
  voltarBtnAbsoluto: {
    position: 'absolute',
    top: 40,
    left: 20,
    zIndex: 20,
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 10,
    borderRadius: 20,
  },
  bannerContingencia: {
    width: '100%',
    backgroundColor: '#d93025',
    padding: 10,
    borderRadius: 6,
    marginBottom: 10,
    alignItems: 'center',
  },
  bannerContingenciaTexto: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  cardStatus: {
    width: '100%',
    backgroundColor: '#f8f9fa',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginBottom: 15,
  },
  statusLinha: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
  statusValor: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  backupTexto: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  cardSync: {
    width: '100%',
    backgroundColor: '#e8f0fe',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1a73e8',
    marginBottom: 15,
    alignItems: 'center',
  },
  cardSyncTexto: {
    color: '#1a73e8',
    fontWeight: 'bold',
    fontSize: 14,
  },
  cardSyncSubtexto: {
    color: '#555',
    fontSize: 12,
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    elevation: 5,
  },
  modalTitulo: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#333',
    textAlign: 'center',
  },
  modalSubtitulo: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
    textAlign: 'center',
  },
  itemPedido: {
    width: '100%',
    padding: 12,
    backgroundColor: '#f8f9fa',
    borderColor: '#eee',
    borderWidth: 1,
    borderRadius: 8,
    marginBottom: 8,
  },
  itemPedidoTexto: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
  btnFechar: {
    marginTop: 12,
    padding: 10,
  },
  scannerFooter: {
    height: '40%',
    backgroundColor: '#fff',
    padding: 20,
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  scannerCounts: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
  },
  countBox: {
    alignItems: 'center',
    padding: 15,
    backgroundColor: '#f0f4f9',
    borderRadius: 8,
    width: '45%',
  },
  countLabel: {
    fontSize: 14,
    color: '#555',
  },
  countValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1a2942',
  },
  calendarioHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: 15,
  },
  calendarioGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: '100%',
  },
  dia: {
    width: '14.28%',
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 2,
  },
  diaTexto: {
    fontSize: 14,
    color: '#333',
  },
  diaHoje: {
    backgroundColor: '#1a73e8',
    borderRadius: 20,
  },
  diaHojeTexto: {
    color: '#fff',
    fontWeight: 'bold',
  },
  diaVazio: {
    width: '14.28%',
    height: 40,
  },
});