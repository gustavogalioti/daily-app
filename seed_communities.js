// Script para rodar no Railway - semeia comunidades regionais do Brasil
// Cole no console do Railway ou rode como script separado

const BRASIL_DATA = {
  estados: [
    { uf: 'SP', nome: 'São Paulo', cidades: ['São Paulo','Campinas','Santos','São Bernardo do Campo','Santo André','Guarulhos','Jundiaí','Sorocaba','Ribeirão Preto','São José dos Campos','Osasco','Mauá','Carapicuíba','Bauru','Piracicaba','São Vicente','Franca','Praia Grande','Limeira','Suzano'] },
    { uf: 'RJ', nome: 'Rio de Janeiro', cidades: ['Rio de Janeiro','Niterói','Duque de Caxias','Nova Iguaçu','São Gonçalo','Belford Roxo','Petrópolis','Volta Redonda','Magé','Macaé'] },
    { uf: 'MG', nome: 'Minas Gerais', cidades: ['Belo Horizonte','Uberlândia','Contagem','Juiz de Fora','Betim','Montes Claros','Ribeirão das Neves','Uberaba','Governador Valadares','Ipatinga'] },
    { uf: 'RS', nome: 'Rio Grande do Sul', cidades: ['Porto Alegre','Caxias do Sul','Pelotas','Canoas','Santa Maria','Gravataí','Viamão','Novo Hamburgo','São Leopoldo','Rio Grande'] },
    { uf: 'PR', nome: 'Paraná', cidades: ['Curitiba','Londrina','Maringá','Ponta Grossa','Cascavel','São José dos Pinhais','Foz do Iguaçu','Colombo','Guarapuava','Paranaguá'] },
    { uf: 'BA', nome: 'Bahia', cidades: ['Salvador','Feira de Santana','Vitória da Conquista','Camaçari','Itabuna','Juazeiro','Lauro de Freitas','Ilhéus','Jequié','Teixeira de Freitas'] },
    { uf: 'SC', nome: 'Santa Catarina', cidades: ['Florianópolis','Joinville','Blumenau','São José','Chapecó','Itajaí','Criciúma','Jaraguá do Sul','Lages','Palhoça'] },
    { uf: 'PE', nome: 'Pernambuco', cidades: ['Recife','Caruaru','Olinda','Petrolina','Paulista','Jaboatão dos Guararapes','Camaragibe','Cabo de Santo Agostinho','Garanhuns','Vitória de Santo Antão'] },
    { uf: 'CE', nome: 'Ceará', cidades: ['Fortaleza','Caucaia','Juazeiro do Norte','Maracanaú','Sobral','Crato','Itapipoca','Maranguape','Iguatu','Quixadá'] },
    { uf: 'GO', nome: 'Goiás', cidades: ['Goiânia','Aparecida de Goiânia','Anápolis','Rio Verde','Luziânia','Águas Lindas de Goiás','Valparaíso de Goiás','Trindade','Formosa','Novo Gama'] },
    { uf: 'PA', nome: 'Pará', cidades: ['Belém','Ananindeua','Santarém','Marabá','Parauapebas','Castanhal','Abaetetuba','Cametá','Altamira','Itaituba'] },
    { uf: 'MA', nome: 'Maranhão', cidades: ['São Luís','Imperatriz','Timon','Caxias','Codó','Paço do Lumiar','Açailândia','Bacabal','Balsas','Santa Inês'] },
    { uf: 'AM', nome: 'Amazonas', cidades: ['Manaus','Parintins','Itacoatiara','Manacapuru','Coari','Tefé','Tabatinga','Maués','Iranduba','Humaitá'] },
    { uf: 'MT', nome: 'Mato Grosso', cidades: ['Cuiabá','Várzea Grande','Rondonópolis','Sinop','Tangará da Serra','Cáceres','Sorriso','Lucas do Rio Verde','Barra do Garças','Alta Floresta'] },
    { uf: 'MS', nome: 'Mato Grosso do Sul', cidades: ['Campo Grande','Dourados','Três Lagoas','Corumbá','Grande Dourados','Ponta Porã','Naviraí','Nova Andradina','Aquidauana','Sidrolândia'] },
    { uf: 'RN', nome: 'Rio Grande do Norte', cidades: ['Natal','Mossoró','Parnamirim','São Gonçalo do Amarante','Macaíba','Ceará-Mirim','Caicó','Assu','Currais Novos','Santa Cruz'] },
    { uf: 'AL', nome: 'Alagoas', cidades: ['Maceió','Arapiraca','Rio Largo','Palmeira dos Índios','União dos Palmares','Penedo','São Miguel dos Campos','Delmiro Gouveia','Marechal Deodoro','Coruripe'] },
    { uf: 'PB', nome: 'Paraíba', cidades: ['João Pessoa','Campina Grande','Santa Rita','Patos','Bayeux','Sousa','Cajazeiras','Guarabira','Cabedelo','Princesa Isabel'] },
    { uf: 'ES', nome: 'Espírito Santo', cidades: ['Vitória','Serra','Vila Velha','Cariacica','Cachoeiro de Itapemirim','Linhares','São Mateus','Colatina','Guarapari','Aracruz'] },
    { uf: 'PI', nome: 'Piauí', cidades: ['Teresina','Parnaíba','Picos','Piripiri','Floriano','Campo Maior','Barras','União','Altos','José de Freitas'] },
    { uf: 'SE', nome: 'Sergipe', cidades: ['Aracaju','Nossa Senhora do Socorro','Lagarto','Itabaiana','Caruaru','São Cristóvão','Estância','Tobias Barreto','Simão Dias','Propriá'] },
    { uf: 'RO', nome: 'Rondônia', cidades: ['Porto Velho','Ji-Paraná','Ariquemes','Vilhena','Cacoal','Rolim de Moura','Jaru','Guajará-Mirim','Ouro Preto do Oeste','Espigão do Oeste'] },
    { uf: 'TO', nome: 'Tocantins', cidades: ['Palmas','Araguaína','Gurupi','Porto Nacional','Paraíso do Tocantins','Colinas do Tocantins','Guaraí','Tocantinópolis','Miracema do Tocantins','Dianópolis'] },
    { uf: 'AC', nome: 'Acre', cidades: ['Rio Branco','Cruzeiro do Sul','Sena Madureira','Tarauacá','Feijó'] },
    { uf: 'AP', nome: 'Amapá', cidades: ['Macapá','Santana','Laranjal do Jari','Oiapoque','Mazagão'] },
    { uf: 'RR', nome: 'Roraima', cidades: ['Boa Vista','Caracaraí','Rorainópolis','Mucajaí','Alto Alegre'] },
    { uf: 'DF', nome: 'Distrito Federal', cidades: ['Brasília','Ceilândia','Taguatinga','Samambaia','Planaltina','Gama','Aguas Claras','Guará','Recanto das Emas','Santa Maria'] },
  ]
};

module.exports = { BRASIL_DATA };
