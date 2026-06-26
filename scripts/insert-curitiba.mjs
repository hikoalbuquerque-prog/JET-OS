#!/usr/bin/env node
// Script para inserir estações de Curitiba no Supabase
// 1. Lê todas as 2636 estações (planilha completa)
// 2. Lê as 441 estações da fase 1
// 3. Cruza por lat/lng (proximity < 30m)
// 4. Insere todas, marcando fase 1 com status='ATIVO' e as demais com status='PLANEJADO'

import { readFileSync } from 'fs';

const SUPABASE_URL = 'https://ducdbrupxpzqcblfreqn.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1Y2RicnVweHB6cWNibGZyZXFuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQ3NDk3MiwiZXhwIjoyMDk3MDUwOTcyfQ.oPTO4DXifwCUx_HYc0KHbynxyRTIqPBeK_9nKrK5hc4';

// Parse the full Curitiba CSV (Brazilian comma decimals)
function parseAllStations(csv) {
  const lines = csv.split('\n').filter(l => l.trim());
  const stations = [];
  for (let i = 1; i < lines.length; i++) {
    // CSV format: #,Código,"Endereço",Bairro,"Latitude","Longitude",Foto,Croqui
    // Use regex to handle quoted fields
    const match = lines[i].match(/^(\d+),([^,]+),"?([^"]*)"?,([^,]+),"?([^"]*)"?,"?([^"]*)"?,/);
    if (!match) continue;
    const codigo = match[2].trim();
    const endereco = match[3].trim();
    const bairro = match[4].trim();
    // Brazilian format: -25,411224 → -25.411224
    const lat = parseFloat(match[5].replace(',', '.'));
    const lng = parseFloat(match[6].replace(',', '.'));
    if (isNaN(lat) || isNaN(lng)) continue;
    stations.push({ codigo, endereco, bairro, lat, lng });
  }
  return stations;
}

// Phase 1 stations (already dot decimals)
const FASE1_RAW = `1|Avenida Sete de Setembro, 5236 - Batel|-25.445814|-49.288376
2|Rua Emiliano Perneta, 924 - Batel|-25.439051|-49.279603
3|Rua Carmelo Rangel, 342 - Batel|-25.44203|-49.29298
4|Rua Carneiro Lobo, 730 - Batel|-25.444413|-49.29176
5|Rua Francisco Rocha, 1151 - Bigorrilho|-25.436018|-49.292938
6|Rua Gutemberg, 585 - Batel|-25.440096|-49.29046
7|Rua Hermes Fontes - Batel|-25.442493|-49.291477
8|Rua Olavo Bilac, 429 - Batel|-25.441421|-49.294583
9|Rua Olavo Bilac, 701 - Batel|-25.442497|-49.297163
10|Avenida Vicente Machado, 792 - Batel|-25.436152|-49.284351
11|Avenida Vicente Machado, 957 - Batel|-25.436838|-49.285716
12|Avenida Vicente Machado, 878 - Batel|-25.436687|-49.285445
13|Rua Coronel Dulcídio, 379 - Batel|-25.437338|-49.284886
14|Rua Bruno Filgueira, 360 - Batel|-25.446178|-49.289257
15|Avenida Sete de Setembro, 5402 - Batel|-25.446646|-49.290385
16|Avenida Sete de Setembro, 5708 - Batel|-25.447494|-49.292614
17|Rua Bispo Dom José, 2181 - Batel|-25.444855|-49.293557
18|Rua Alferes Ângelo Sampaio, 1166 - Batel|-25.442994|-49.282802
19|Avenida do Batel, 1230 - Batel|-25.441432|-49.28507
20|Rua Alferes Ângelo Sampaio, 1177 - Batel|-25.442747|-49.282948
21|Avenida do Batel, 1398 - Batel|-25.441874|-49.286582
22|Rua Pasteur, 463 - Água Verde|-25.443956|-49.279129
23|Avenida Sete de Setembro - Centro|-25.441199|-49.276377
24|Rua Bento Viana, 1200 - Batel|-25.442904|-49.284452
25|Rua Pasteur, 52 - Batel|-25.439935|-49.280998
26|Rua Benjamin Lins - Batel|-25.440748|-49.283306
27|Rua Padre Ildefonso, 280 - Batel|-25.445029|-49.286668
28|Avenida Sete de Setembro - Batel|-25.445179|-49.286778
29|Avenida Sete de Setembro - Batel|-25.445623|-49.288254
30|Rua Benjamin Lins - Batel|-25.440784|-49.283649
31|Rua Coronel Dulcídio, 1113 - Batel|-25.442995|-49.281034
32|Avenida Sete de Setembro, 4155 - Água Verde|-25.44256|-49.279093
33|Rua Silveira Peixoto, 1025 - Batel|-25.444588|-49.285583
34|Rua Pasteur, 300 - Batel|-25.442466|-49.279989
35|Avenida Sete de Setembro, 4115 - Água Verde|-25.442312|-49.278499
36|Avenida Sete de Setembro - Centro|-25.441048|-49.276453
37|Alameda Presidente Taunay, 444 - Batel|-25.435497|-49.285227
38|Avenida Sete de Setembro, 5082 - Batel|-25.445473|-49.287487
39|Rua Bento Viana, 1078 - Batel|-25.444159|-49.28448
40|Rua Carmelo Rangel, 770 - Seminário|-25.443526|-49.29697
41|Avenida Sete de Setembro, 4538 - Batel|-25.443528|-49.282443
42|Canaleta Exclusiva BRT - Água Verde|-25.445493|-49.28678
43|Rua Bispo Dom José, 2348 - Batel|-25.445453|-49.295224
44|Rua Fernando Simas, 1239 - Mercês|-25.425356|-49.291865
45|Rua Francisco Rocha, 1221 - Bigorrilho|-25.435429|-49.293268
46|Rua Desembargador Isaías Beviláqua, 947 - Mercês|-25.426468|-49.291087
47|Alameda Dom Pedro II, 919 - Batel|-25.441797|-49.289786
48|Rua Comendador Araújo, 862 - Batel|-25.439368|-49.282629
49|Rua Bruno Filgueira - Batel|-25.439026|-49.29131
50|Rua Comendador Araújo, 748 - Batel|-25.438447|-49.281943
51|Rua Bruno Filgueira, 1293 - Batel|-25.438444|-49.29337
52|Alameda Doutor Carlos de Carvalho, 1825 - Batel|-25.437853|-49.291943
53|Alameda Presidente Taunay, 90 - Batel|-25.437477|-49.283031
54|Alameda Dom Pedro II, 21 - Batel|-25.43644|-49.282001
55|Avenida Sete de Setembro, 6809 - Batel|-25.451586|-49.302884
56|Rua Inácio Lustosa - Centro Cívico|-25.424329|-49.269704
57|Centro Cívico|-25.422725|-49.269926
58|Rua Senador Xavier da Silva, 488 - Centro Cívico|-25.421659|-49.269787
59|Rua Senador Xavier da Silva - Centro Cívico|-25.421572|-49.270710
60|Rua Heitor Stockler de França, 396 - Centro Cívico|-25.420477|-49.268951
61|Rua Mateus Leme, 1190 - Centro Cívico|-25.416826|-49.271165
62|Centro Cívico|-25.416322|-49.268397
63|Rua Deputado Mário de Barros - Centro Cívico|-25.413957|-49.267431
64|Rua Professor Benedito Nicolau dos Santos - Centro Cívico|-25.413763|-49.266165
65|Rua Professor Benedito Nicolau dos Santos, 558 - Centro Cívico|-25.413027|-49.271036
66|Rua Deputado Mário de Barros - Centro Cívico|-25.412368|-49.266144
67|Rua Deputado Mário de Barros, 1548 - Centro Cívico|-25.412127|-49.268889
68|Rua Mateus Leme, 1764 - Centro Cívico|-25.411903|-49.271465
69|Rua Marechal Hermes, 247 - Centro Cívico|-25.417091|-49.265515
70|Rua Doutor Faivre, 18 - Centro|-25.423648|-49.264218
71|Rua General Carneiro, 451 - Centro|-25.426266|-49.261723
72|Rua Nunes Machado, 1891 - Rebouças|-25.453177|-49.268015
73|Alameda Doutor Muricy, 1089 - São Francisco|-25.428363|-49.274314
74|Alameda Doutor Carlos de Carvalho, 217 - Centro|-25.431987|-49.277132
75|Rua Conselheiro Araújo, 367 - Alto da Glória|-25.425178|-49.261028
76|Alameda Doutor Carlos de Carvalho, 2435 - Batel|-25.440305|-49.298052
77|Alameda Doutor Carlos de Carvalho, 331 - Centro|-25.432356|-49.278130
78|Alameda Doutor Carlos de Carvalho, 768 - Centro|-25.433868|-49.282244
79|Alameda Prudente de Moraes, 404 - Mercês|-25.425771|-49.284640
80|Rua Barão do Serro Azul, 110 - Centro|-25.427833|-49.270873
81|Avenida Agostinho Leão Júnior - Alto da Glória|-25.421224|-49.261546
82|Rua Heitor Stockler de França, 396 - Centro Cívico|-25.420459|-49.268926
83|Rua Comendador Fontana, 14 - Centro Cívico|-25.419237|-49.268605
84|Centro Cívico|-25.423985|-49.269814
85|Rua Doutor Roberto Barrozo, 165 - Centro Cívico|-25.418043|-49.269591
86|Rua Papa João XXIII, 387 - Centro Cívico|-25.416457|-49.269287
87|Rua Jacy Loureiro de Campos - Centro Cívico|-25.416138|-49.270184
88|Rua Professor Benedito Nicolau dos Santos, 516 - Centro Cívico|-25.413411|-49.270223
89|Avenida João Gualberto - Centro Cívico|-25.423802|-49.268609
90|Avenida João Gualberto, 250 - Centro|-25.423618|-49.267510
91|Avenida João Gualberto - Centro Cívico|-25.423512|-49.268165
92|Alameda Augusto Stellfeld - Centro|-25.428844|-49.275200
93|Rua 13 de Maio, 234 - Centro|-25.427453|-49.268423
94|Avenida Sete de Setembro, 1865 - Jardim Botânico|-25.434111|-49.257268
95|Avenida Vicente Machado, 218 - Centro|-25.434170|-49.279056
96|Rua Mariano Torres, 398 - Centro|-25.429842|-49.262961
97|Rua Conselheiro Laurindo - Rebouças|-25.436607|-49.261827
98|Rua Marechal Deodoro, 748 - Centro|-25.429566|-49.265263
99|Rua Tibagi - Centro|-25.427117|-49.264804
100|Canaleta Exclusiva BRT - Centro|-25.436041|-49.274123
101|Rua Presidente Carlos Cavalcanti, 327 - Centro|-25.426415|-49.268511
102|Canaleta Exclusiva BRT, 226 - Centro|-25.428690|-49.268140
103|Rua Mariano Torres, 47 - Centro|-25.427016|-49.264192
104|Rua Mariano Torres, 98 - Centro|-25.427351|-49.264090
105|Rua 13 de Maio, 18 - Centro|-25.427830|-49.265900
106|Rua Conselheiro Laurindo, 175 - Centro|-25.428735|-49.265584
107|Avenida Marechal Floriano Peixoto - Centro|-25.430364|-49.272360
108|Centro|-25.429510|-49.269889
109|Rua Benjamin Constant, 386 - Centro|-25.429160|-49.261137
110|Rua Benjamin Constant, 510 - Centro|-25.428753|-49.260330
111|Rua Saldanha da Gama, 135 - Centro|-25.428289|-49.259022
112|Rua Benjamin Constant, 626 - Centro|-25.428040|-49.258590
113|Rua Heitor Stockler de França, 119 - Centro Cívico|-25.423160|-49.268555
114|Praça Tiradentes, 554 - Centro|-25.429940|-49.271043
115|Rua Visconde de Nacar - Centro|-25.436681|-49.274367
116|Rua Emiliano Perneta, 661 - Centro|-25.435190|-49.275322
117|Centro|-25.428659|-49.267418
118|Praça Zacarias, 31 - Centro|-25.432554|-49.272623
119|Rua Almirante Gonçalves, 1685 - Rebouças|-25.448166|-49.267911
120|Rua Almirante Gonçalves, 1685 - Rebouças|-25.448291|-49.267981
121|Rua André de Barros, 249 - Centro|-25.435266|-49.270014
122|Rua André de Barros, 419 - Centro|-25.434819|-49.268798
123|Rua Riachuelo, 102 SL - Centro|-25.429325|-49.269249
124|Rua Benjamin Constant, 138 - Centro|-25.430064|-49.263585
125|Rua Brigadeiro Franco, 1877 - Centro|-25.437315|-49.279042
126|Rua Cândido Lopes, 133 - Centro|-25.430662|-49.273221
127|Rua Marechal Hermes, 10 - Alto da Glória|-25.419000|-49.265592
128|Rua Comendador Macedo, 407 - Centro|-25.430010|-49.260647
129|Rua Conselheiro Araújo, 161 - Centro|-25.426040|-49.262964
130|Rua Doutor Faivre, 273 - Centro|-25.425887|-49.262939
131|Rua Conselheiro Araújo, 300 - Centro|-25.425619|-49.261875
132|Rua Conselheiro Laurindo, 517 - Centro|-25.431391|-49.264367
133|Rua Nilo Cairo, 29 - Centro|-25.432776|-49.263677
134|Rua da Glória, 52 - Alto da Glória|-25.422520|-49.266864
135|Avenida João Gualberto - Centro|-25.424887|-49.269464
136|Rua Pedro Ivo - Centro|-25.432046|-49.265525
137|Rua Lamenha Lins, 1511 - Rebouças|-25.449366|-49.270985
138|Rua Chile, 2134 - Rebouças|-25.452189|-49.269536
139|Rua Conselheiro Araújo - Centro|-25.426803|-49.264740
140|Rua Francisco Torres, 59 - Centro|-25.428418|-49.262588
141|Rua Francisco Torres, 59 - Centro|-25.428282|-49.262545
142|Rua Marechal Deodoro, 1115 - Centro|-25.428458|-49.262486
143|Rua General Carneiro, 614 - Centro|-25.427853|-49.260900
144|Rua Ubaldino do Amaral, 680 - Centro|-25.426919|-49.258979
145|Rua Marechal Deodoro, 945 - Centro|-25.428935|-49.263424
146|Rua Marechal Hermes, 247 - Centro Cívico|-25.417063|-49.265652
147|Rua Mariano Torres, 204 - Centro|-25.428192|-49.263732
148|Rua Mariano Torres, 350 - Centro|-25.429753|-49.263002
149|Rua Mariano Torres, 592 - Centro|-25.431952|-49.261986
150|Rua Mariano Torres, 698 - Centro|-25.432503|-49.261744
151|Rua Mariano Torres, 792 - Centro|-25.433670|-49.261197
152|Rua Monsenhor Celso, 154 - Centro|-25.431621|-49.270409
153|Rua Nilo Cairo, 218 - Centro|-25.431989|-49.261718
154|Rua Nilo Cairo, 86 - Centro|-25.432504|-49.262996
155|Rua Almirante Gonçalves, 1889 - Rebouças|-25.449082|-49.270012
156|Rua Padre Antônio, 33 - Alto da Glória|-25.422564|-49.266523
157|Rua João Manoel, 142 - São Francisco|-25.424973|-49.276396
158|Rua Visconde de Nacar, 989 - Centro|-25.431355|-49.278614
159|Rua Saldanha Marinho, 2787 - Bigorrilho|-25.438062|-49.296272
160|Rua Saldanha Marinho, 3000 - Bigorrilho|-25.439102|-49.298648
161|Rua Saldanha Marinho, 3128 - Bigorrilho|-25.439443|-49.299744
162|Rua Jerônimo Durski, 850 - Bigorrilho|-25.439614|-49.300278
163|Rua General Mário Tourinho, 1175 - Campina do Siqueira|-25.441780|-49.305883
164|Alameda Doutor Carlos de Carvalho, 2847 - Campina do Siqueira|-25.441533|-49.301638
165|Rua Francisco Torres, 35 - Centro|-25.427863|-49.262857
166|Rua 7 de Abril, 38 - Alto da Rua XV|-25.431446|-49.256857
167|Avenida Vicente Machado, 2089 - Batel|-25.440974|-49.296145
168|Avenida Vicente Machado, 2221 - Batel|-25.441334|-49.297171
169|Avenida Vicente Machado, 2753 - Seminário|-25.443625|-49.301908
170|Rua Brigadeiro Franco, 1491 - Centro|-25.435071|-49.281635
171|Rua Visconde do Rio Branco, 1302 - Centro|-25.433096|-49.279744
172|Rua Voluntários da Pátria, 117 - Centro|-25.433751|-49.273661
173|Rua XV de Novembro, 1181 - Centro|-25.427719|-49.262846
174|Rua Doutor Faivre, 471 - Centro|-25.427565|-49.262167
175|Rua Doutor Faivre, 405 - Centro|-25.427387|-49.262156
176|Rua XV de Novembro, 1580 - Centro|-25.426284|-49.259247
177|Rua Prefeito João Moreira Garcez, 138 - Centro|-25.429118|-49.270002
178|Rua Conselheiro Laurindo, 400 - Centro|-25.430529|-49.264805
179|Rua XV de Novembro, 950 - Centro|-25.428715|-49.265434
180|Rua Almirante Gonçalves, 1749 - Rebouças|-25.448607|-49.268750
181|Rua Emiliano Perneta, 661 - Centro|-25.435816|-49.274589
182|Rua Emiliano Perneta, 10 - Centro|-25.432904|-49.272870
183|Rua Emiliano Perneta - Centro|-25.436290|-49.276772
184|Rua Emiliano Perneta, 640 - Centro|-25.436805|-49.277189
185|Rua Emiliano Perneta, 886 - Centro|-25.438634|-49.279325
186|Alameda Doutor Carlos de Carvalho, 74 - Centro|-25.431573|-49.276143
187|Avenida Sete de Setembro, 2134 - Centro|-25.434822|-49.259596
188|Praça Senador Correia - Centro|-25.432992|-49.264646
189|Praça Senador Correia - Centro|-25.432126|-49.265065
190|Rua André de Barros, 671 - Centro|-25.433714|-49.266170
191|Alameda Cabral, 407 - São Francisco|-25.429643|-49.278120
192|Rua Barão do Serro Azul, 421 - São Francisco|-25.425343|-49.270398
193|Rua Barão do Serro Azul, 124 - Centro|-25.428240|-49.270960
194|Rua Barão do Rio Branco, 63 - Centro|-25.430930|-49.268785
195|Rua Comendador Araújo, 489 - Centro|-25.436695|-49.279974
196|Rua Nilo Cairo, 480 - Centro|-25.430620|-49.258330
197|Rua Almirante Gonçalves, 1510 - Rebouças|-25.447506|-49.265944
198|Rua Doutor Faivre, 405 - Centro|-25.426684|-49.262517
199|Rua Doutor Faivre, 340 - Centro|-25.426630|-49.262660
200|Rua Doutor Faivre, 563 - Centro|-25.428241|-49.261819
201|Rua Nilo Cairo, 318 - Centro|-25.431637|-49.260904
202|Rua Senador Xavier da Silva, 441 - Centro Cívico|-25.421338|-49.270778
203|Rua David Carneiro, 205 - São Francisco|-25.419797|-49.271177
204|Rua Napoleão Lopes, 30 - São Francisco|-25.418654|-49.271278
205|Rua Coronel Agostinho Macedo, 79 - Centro Cívico|-25.415439|-49.271240
206|Rua Tibagi, 137 - Centro|-25.428120|-49.264529
207|Praça Tiradentes, 476 - Centro|-25.430295|-49.272134
208|Rua Tibagi, 201 - Centro|-25.428818|-49.264230
209|Rua Brigadeiro Franco, 2063 - Centro|-25.438739|-49.277711
210|Rua Padre Camargo, 234 - Alto da Glória|-25.422181|-49.262544
211|Rua Conselheiro Araújo, 187 - Centro|-25.424670|-49.265269
212|Avenida Sete de Setembro, 3330 - Centro|-25.439370|-49.271324
213|Avenida Sete de Setembro, 3544 - Centro|-25.440064|-49.273160
214|Avenida Marechal Floriano Peixoto, 374 - Centro|-25.433617|-49.270636
215|Canaleta Exclusiva BRT - Rebouças|-25.440812|-49.275050
216|Avenida Sete de Setembro - Centro|-25.441006|-49.275912
217|Rua Conselheiro Araújo - Centro|-25.426315|-49.263828
218|Avenida Iguaçu, 100 - Rebouças|-25.439599|-49.262981
219|Rua Desembargador Westphalen - Centro|-25.438120|-49.270260
220|Rua Luiz Leão, 391 - Centro|-25.425520|-49.265905
221|Rua Tibagi, 740 - Centro|-25.433307|-49.262323
222|Avenida Marechal Floriano Peixoto, 116 - Centro|-25.431395|-49.271712
223|Rua Doutor Pedrosa, 333 - Centro|-25.438343|-49.277431
224|Rua Ébano Pereira, 67 - Centro|-25.431239|-49.274016
225|Rua Brigadeiro Franco, 2213 - Centro|-25.439849|-49.277161
226|Travessa da Lapa, 670 - Centro|-25.431481|-49.267248
227|Rua Desembargador Ermelino de Leão, 15 - Centro|-25.432282|-49.274629
228|Avenida Marechal Floriano Peixoto, 276 - Centro|-25.432883|-49.270992
229|Rua XV de Novembro, 217 - Centro|-25.430909|-49.271888
230|Avenida Presidente Getúlio Vargas - Rebouças|-25.440484|-49.260295
231|Rua João Negrão, 1285 - Rebouças|-25.440882|-49.261453
232|Avenida Presidente Getúlio Vargas - Rebouças|-25.440795|-49.261143
233|Avenida Sete de Setembro - Centro|-25.440808|-49.275326
234|Avenida Sete de Setembro, 2154 - Centro|-25.435073|-49.260273
235|Avenida Sete de Setembro, 3666 - Centro|-25.440503|-49.274499
236|Avenida Sete de Setembro, 2630 - Centro|-25.436649|-49.264484
237|Avenida Sete de Setembro, 2331 - Rebouças|-25.435903|-49.261350
238|Avenida Silva Jardim, 230 - Rebouças|-25.438060|-49.263354
239|Rua Conselheiro Laurindo, 902 - Centro|-25.434511|-49.263240
240|Rua Brigadeiro Franco, 1275 - Centro|-25.432887|-49.282536
241|Rua Barão do Rio Branco, 519 - Centro|-25.434536|-49.267145
242|Rua Barão do Rio Branco, 647 - Centro|-25.435790|-49.266569
243|Rua André de Barros - Centro|-25.437033|-49.274222
244|Rua Pedro Ivo, 285 - Centro|-25.434095|-49.270979
245|Rua Comendador Araújo, 171 - Centro|-25.434859|-49.277792
246|Rua Desembargador Westphalen - Centro|-25.434910|-49.272207
247|Avenida Marechal Floriano Peixoto, 374 - Centro|-25.433797|-49.270623
248|Alameda Cabral, 275 - Centro|-25.430632|-49.277600
249|Rua Pedro Ivo, 739 - Centro|-25.432419|-49.266810
250|Rua Doutor Pedrosa, 68 - Centro|-25.437383|-49.275183
251|Rua José Loureiro, 524 - Centro|-25.431749|-49.267347
252|Alameda Cabral, 164 - Centro|-25.431515|-49.277279
253|Rua Comendador Araújo, 80 - Centro|-25.434195|-49.277110
254|Rua Brigadeiro Franco, 2021 - Centro|-25.438086|-49.278214
255|Rua Brigadeiro Franco, 2157 - Centro|-25.439484|-49.277402
256|Rua Brigadeiro Franco, 2063 - Centro|-25.438700|-49.277703
257|Centro|-25.429662|-49.269586
258|Rua Tibagi, 900 - Centro|-25.429210|-49.263965
259|Rua Pedro Ivo, 127 - Centro|-25.434601|-49.272086
260|Rua Doutor Pedrosa, 10 - Centro|-25.437193|-49.274686
261|Avenida Vicente Machado, 548 - Centro|-25.435280|-49.281965
262|Rua Doutor Pedrosa, 157 - Centro|-25.437763|-49.275995
263|Rua Barão do Rio Branco, 158 - Centro|-25.431665|-49.268569
264|Centro|-25.429662|-49.270409
265|Rua Comendador Araújo, 241 - Centro|-25.435255|-49.278242
266|Rua Lourenço Pinto, 400 - Centro|-25.436804|-49.267776
267|Rua Brigadeiro Franco, 2190 - Centro|-25.439166|-49.277603
268|Rua André de Barros - Centro|-25.436836|-49.273658
269|Rua Visconde do Rio Branco, 1165 - Centro|-25.431904|-49.280209
270|Rua Amintas de Barros, 93 - Centro|-25.427547|-49.264855
271|Rua 24 de Maio, 158 - Centro|-25.438511|-49.273709
272|Rua Pedro Ivo, 181 - Centro|-25.434477|-49.271931
273|Canaleta Exclusiva BRT - Centro|-25.434012|-49.276758
274|Canaleta Exclusiva BRT - Centro|-25.434425|-49.270356
275|Rua Comendador Araújo, 415 - Centro|-25.436340|-49.279455
276|Rua José Loureiro, 464 - Centro|-25.432058|-49.268121
277|Rua José Loureiro, 720 - Centro|-25.431084|-49.265700
278|Rua Pedro Ivo, 699 - Centro|-25.432673|-49.267285
279|Rua Barão do Rio Branco, 465 - Centro|-25.433664|-49.267549
280|Rua Brigadeiro Franco, 2300 - Centro|-25.440396|-49.276865
281|Rua Saldanha Marinho, 1290 - Centro|-25.433243|-49.283819
282|Rua Desembargador Motta, 2500 - Centro|-25.433607|-49.283858
283|Rua Cândido Lopes, 133 - Centro|-25.430918|-49.273916
284|Rua Lamenha Lins, 355 - Centro|-25.439821|-49.275708
285|Avenida Luiz Xavier - Centro|-25.432538|-49.275403
286|Rua Brigadeiro Franco, 2300 - Centro|-25.440678|-49.276678
287|Rua Brigadeiro Franco, 2300 - Centro|-25.440359|-49.276916
288|Travessa Tobias de Macedo, 28 - Centro|-25.429784|-49.270982
289|Praça Tiradentes, 330 - Centro|-25.429781|-49.272309
290|Rua Lysímaco Ferreira da Costa, 29 - Centro Cívico|-25.417718|-49.265269
291|Canaleta Exclusiva BRT - Centro|-25.435896|-49.273606
292|Rua André de Barros - Centro|-25.436122|-49.273009
293|Rua Senador Alencar Guimarães - Centro|-25.435472|-49.273054
294|Rua Francisco Torres, 528 - Centro|-25.432280|-49.260774
295|Travessa Jesuíno Marcondes, 10 - Centro|-25.433555|-49.276521
296|Rua Doutor Pedrosa, 203 - Centro|-25.437891|-49.276345
297|Rua Alferes Poli, 381 - Rebouças|-25.439867|-49.271908
298|Rua Barão do Rio Branco, 245 - Centro|-25.432337|-49.268153
299|Rua Barão do Rio Branco, 285 - Centro|-25.432789|-49.267938
300|Rua Barão do Rio Branco, 465 - Centro|-25.434082|-49.267323
301|Rua Barão do Rio Branco, 395 - Centro|-25.433324|-49.267693
302|Rua Barão do Serro Azul, 20 - Centro|-25.428836|-49.271248
303|Rua Benjamin Constant, 257 - Centro|-25.429493|-49.262409
304|Rua Benjamin Constant, 303 - Centro|-25.429386|-49.262000
305|Rua Comendador Macedo, 275 - Centro|-25.430415|-49.261748
306|Rua Conselheiro Laurindo - Rebouças|-25.436471|-49.262178
307|Rua Desembargador Westphalen, 190 - Centro|-25.434248|-49.272188
308|Rua André de Barros, 136 - Centro|-25.436000|-49.271228
309|Rua Desembargador Westphalen, 92 - Centro|-25.433620|-49.272481
310|Rua Euzébio da Motta, 177 - Alto da Glória|-25.416448|-49.264256
311|Rua Francisco Torres, 650 - Centro|-25.433398|-49.260336
312|Rua Francisco Torres, 110 - Centro|-25.428771|-49.262439
313|Rua Francisco Torres, 244 - Centro|-25.429932|-49.261915
314|Rua Marechal Hermes, 219 - Centro Cívico|-25.417130|-49.265804
315|Rua Ivo Leão, 693 - Centro Cívico|-25.416831|-49.266277
316|Rua José Loureiro, 291 - Centro|-25.432524|-49.269622
317|Rua Barão do Rio Branco, 206 - Centro|-25.432170|-49.268638
318|Avenida Iguaçu, 22 - Rebouças|-25.439397|-49.262247
319|Avenida Iguaçu, 21 - Rebouças|-25.439548|-49.262126
320|Rua Lamenha Lins, 539 - Rebouças|-25.441070|-49.275092
321|Avenida Marechal Floriano Peixoto - Centro|-25.432238|-49.271231
322|Rua Marechal Hermes, 153 - Centro Cívico|-25.417683|-49.265680
323|Rua Mariano Torres, 473 - Centro|-25.430622|-49.262355
324|Rua Mariano Torres, 514 - Centro|-25.431360|-49.262300
325|Rua Monsenhor Celso, 252 - Centro|-25.432251|-49.270287
326|Rua Monsenhor Celso, 154 - Centro|-25.431675|-49.270456
327|Rua Nunes Machado, 325 - Centro|-25.440295|-49.274101
328|Rua Tibagi, 740 - Centro|-25.433304|-49.262384
329|Rua XV de Novembro, 98 - Centro|-25.431624|-49.272797
330|Rua Álvaro Ramos, 86 - Centro Cívico|-25.417095|-49.267008
331|Ciclovia Parque São Lourenço - Passeio Público - Centro|-25.426890|-49.265425
332|Rua Ébano Pereira - Centro|-25.430022|-49.274611
333|Rua Lamenha Lins, 104 - Centro|-25.437681|-49.276652
334|Rua Barão do Rio Branco, 583 - Centro|-25.435167|-49.266844
335|Rua Barão do Rio Branco, 354 - Centro|-25.433072|-49.267824
336|Alameda Doutor Muricy, 439 - Centro|-25.433487|-49.271943
337|Rua Lysímaco Ferreira da Costa, 225 - Centro Cívico|-25.417673|-49.268172
338|Rua Lysímaco Ferreira da Costa, 80 - Centro Cívico|-25.417786|-49.266367
339|Rua Prefeito João Moreira Garcez, 180 - Centro|-25.429417|-49.269905
340|Canaleta Exclusiva BRT - Centro|-25.436455|-49.273738
341|Praça Carlos Gomes - Centro|-25.433320|-49.270678
342|Praça Carlos Gomes - Centro|-25.433560|-49.269792
343|Rua Pedro Ivo, 217 - Centro|-25.434331|-49.271583
344|Rua Comendador Araújo, 375 - Centro|-25.436051|-49.279138
345|Travessa da Lapa - Centro|-25.431704|-49.267166
346|Canaleta Exclusiva BRT - Centro|-25.435024|-49.270068
347|Rua Riachuelo, 31 - Centro|-25.429969|-49.269284
348|Rua André de Barros - Centro|-25.436884|-49.274008
349|Travessa Tobias de Macedo, 28 - Centro|-25.429696|-49.270926
350|Rua Nunes Machado, 15 - Centro|-25.437631|-49.275423
351|Praça Carlos Gomes - Centro|-25.432865|-49.270146
352|Rua 24 de Maio, 68 - Centro|-25.437542|-49.274188
353|Avenida Luiz Xavier, 24 - Centro|-25.431915|-49.273690
354|Avenida Sete de Setembro, 2025 - Jardim Botânico|-25.434642|-49.258574
355|Rua João Negrão, 191 - Centro|-25.431093|-49.266236
356|Alameda Augusto Stellfeld, 173 - Centro|-25.429059|-49.275969
357|Avenida Marechal Floriano Peixoto, 910 - Centro|-25.438216|-49.268635
358|Avenida Sete de Setembro - Centro|-25.438066|-49.268359
359|Rua Desembargador Motta, 1844 - Centro|-25.437982|-49.279979
360|Rua Comendador Araújo, 568 - Centro|-25.437256|-49.280677
361|Rua André de Barros - Centro|-25.436431|-49.272970
362|Rua André de Barros, 6 - Centro|-25.436373|-49.272372
363|Rua Visconde do Rio Branco, 1742 - Centro|-25.436360|-49.276859
364|Avenida Sete de Setembro, 2516 - Centro|-25.436282|-49.263594
365|Rua Emiliano Perneta, 466 - Centro|-25.435893|-49.276331
366|Rua Pedro Ivo, 119 - Centro|-25.434648|-49.272592
367|Rua Visconde de Nacar, 1424 - Centro|-25.434638|-49.276385
368|Avenida Sete de Setembro, 2025 - Jardim Botânico|-25.434629|-49.258549
369|Rua Doutor Faivre, 1274 - Centro|-25.434405|-49.258690
370|Rua Senador Alencar Guimarães, 166 - Centro|-25.434348|-49.274438
371|Avenida Sete de Setembro, 1924 - Centro|-25.434119|-49.257826
372|Avenida Sete de Setembro, 1802 - Centro|-25.433698|-49.256758
373|Rua Visconde de Nacar, 1210 - Centro|-25.433446|-49.277624
374|Avenida Vicente Machado, 24 - Centro|-25.433369|-49.277377
375|Alameda Doutor Carlos de Carvalho, 608 - Centro|-25.433350|-49.280886
376|Rua Ubaldino do Amaral, 1454 - Centro|-25.433324|-49.255906
377|Travessa Jesuíno Marcondes - Centro|-25.433292|-49.276669
378|Alameda Cabral, 427 - Centro|-25.432628|-49.276256
379|Rua da Paz, 310 - Centro|-25.432180|-49.257362
380|Rua Saldanha Marinho, 1014 - Centro|-25.432163|-49.281438
381|Rua Conselheiro Laurindo - Centro|-25.432093|-49.264040
382|Rua Voluntários da Pátria, 475 - Centro|-25.431930|-49.275575
383|Rua Tibagi, 520 - Centro|-25.431692|-49.263028
384|Rua Tibagi, 515 - Centro|-25.431640|-49.262890
385|Rua Cândido Lopes, 270 - Centro|-25.431208|-49.275119
386|Rua Doutor Faivre, 900 - Centro|-25.431192|-49.260176
387|Rua Comendador Macedo, 88 - Centro|-25.431110|-49.263279
388|Rua Tibagi, 440 - Centro|-25.430988|-49.263315
389|Rua Comendador Macedo, 137 - Centro|-25.430978|-49.263181
390|Rua Comendador Macedo, 522 - Centro|-25.430864|-49.262539
391|Rua Comendador Macedo, 246 - Centro|-25.430766|-49.262263
392|Rua Mariano Torres, 480 - Centro|-25.430688|-49.262602
393|Rua Voluntários da Pátria - Centro|-25.430622|-49.277206
394|Rua Cruz Machado, 311 - Centro|-25.430578|-49.275537
395|Rua Nilo Cairo, 643 - Centro|-25.430561|-49.257796
396|Rua Saldanha Marinho, 490 - Centro|-25.430278|-49.276653
397|Rua Tibagi, 366 - Centro|-25.430213|-49.263664
398|Rua Saldanha Marinho, 479 - Centro|-25.430142|-49.275768
399|Rua General Carneiro, 881 - Centro|-25.430043|-49.259674
400|Alameda Doutor Muricy, 926 - Centro|-25.429687|-49.273478
401|Rua Benjamin Constant, 97 - Centro|-25.429654|-49.263910
402|Rua Saldanha Marinho, 214 - Centro|-25.429503|-49.273789
403|Alameda Augusto Stellfeld, 337 - Centro|-25.429471|-49.277216
404|Centro|-25.429450|-49.272619
405|Alameda Augusto Stellfeld, 295 - Centro|-25.429425|-49.277072
406|Rua Saldanha Marinho, 148 - Centro|-25.429424|-49.273603
407|Rua Comendador Macedo, 610 - Centro|-25.429326|-49.258537
408|Rua XV de Novembro, 770 - Centro|-25.429102|-49.266438
409|Alameda Augusto Stellfeld, 173 - Centro|-25.429098|-49.275996
410|Rua Tibagi, 201 - Centro|-25.429090|-49.264150
411|Travessa Tobias de Macedo, 107 - Centro|-25.428980|-49.270082
412|Rua Marechal Deodoro, 945 - Centro|-25.428925|-49.263445
413|Rua Mariano Torres, 275 - Centro|-25.428780|-49.263153
414|Rua Alfredo Bufren, 9 - Centro|-25.428660|-49.269239
415|Rua Marechal Deodoro, 991 - Centro|-25.428494|-49.263327
416|Rua Tibagi, 171 - Centro|-25.428414|-49.264434
417|Rua São Francisco, 50 - Centro|-25.428282|-49.269293
418|Rua XV de Novembro, 1050 - Centro|-25.428262|-49.264059
419|Travessa Nestor de Castro, 95 - Centro|-25.428224|-49.271842
420|Rua Alfredo Bufren, 337 - Centro|-25.428044|-49.265894
421|Rua Mariano Torres, 125 - Centro|-25.427629|-49.263756
422|Rua Presidente Faria, 334 - Centro|-25.427490|-49.268387
423|Rua 13 de Maio, 154 - Centro|-25.427490|-49.267564
424|Rua Marechal Deodoro, 1375 - Centro|-25.427344|-49.259653
425|Rua XV de Novembro, 1382 - Centro|-25.427194|-49.261041
426|Rua XV de Novembro, 1382 - Centro|-25.427160|-49.261057
427|Rua Riachuelo, 347 - Centro|-25.427112|-49.269572
428|Rua Presidente Carlos Cavalcanti - Centro|-25.426988|-49.266386
429|Rua 13 de Maio, 601 - São Francisco|-25.426820|-49.271855
430|Rua 13 de Maio, 512 - Centro|-25.426659|-49.271847
431|Rua Presidente Carlos Cavalcanti, 481 - Centro|-25.426296|-49.269655
432|Rua Amintas de Barros, 473 - Centro|-25.426293|-49.261503
433|Rua General Carneiro, 451 - Centro|-25.426283|-49.261406
434|Rua Paula Gomes, 15 - Centro|-25.425579|-49.269773
435|Rua Amintas de Barros, 637 - Centro|-25.425498|-49.259646
436|Rua Riachuelo - Centro|-25.425303|-49.269591
437|Rua Padre Camargo, 565 - Alto da Glória|-25.425156|-49.261017
438|Rua Doutor Faivre, 141 - Centro|-25.425060|-49.263349
439|Canaleta Exclusiva BRT - Centro|-25.424595|-49.268802
440|Rua Luiz Leão, 451 - Centro|-25.424316|-49.266953
441|Canaleta Exclusiva BRT - Centro|-25.423917|-49.268287`;

function parseFase1() {
  return FASE1_RAW.split('\n').filter(l => l.trim()).map(line => {
    const parts = line.split('|');
    return {
      num: parseInt(parts[0]),
      endereco: parts[1],
      lat: parseFloat(parts[2]),
      lng: parseFloat(parts[3]),
    };
  });
}

// Haversine distance in meters
function dist(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function supaPost(path, body) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${res.status} ${t}`);
  }
  return res;
}

async function main() {
  // 1. Add fase column if not exists
  console.log('Adding fase column...');
  const alterRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({}),
  });
  // We'll use a direct SQL call via the management API instead — just insert with status

  // 2. Parse data
  const csv = readFileSync(new URL('./curitiba_todas.csv', import.meta.url), 'utf8');
  const allStations = parseAllStations(csv);
  console.log(`Parsed ${allStations.length} total Curitiba stations`);

  const fase1 = parseFase1();
  console.log(`Parsed ${fase1.length} phase 1 stations`);

  // 3. Match fase1 to allStations by proximity
  const fase1Codes = new Set();
  const unmatched = [];

  for (const f of fase1) {
    let bestDist = Infinity;
    let bestStation = null;
    for (const s of allStations) {
      const d = dist(f.lat, f.lng, s.lat, s.lng);
      if (d < bestDist) { bestDist = d; bestStation = s; }
    }
    if (bestDist < 50) { // < 50m match
      fase1Codes.add(bestStation.codigo);
    } else {
      unmatched.push({ ...f, bestDist: Math.round(bestDist) });
    }
  }

  console.log(`Matched ${fase1Codes.size} phase 1 stations to codes (threshold 50m)`);
  if (unmatched.length) {
    console.log(`Unmatched: ${unmatched.length}`);
    unmatched.forEach(u => console.log(`  #${u.num} ${u.endereco} (nearest: ${u.bestDist}m)`));
  }

  // 4. Build rows for Supabase
  const rows = allStations.map(s => ({
    codigo: s.codigo,
    geo: `SRID=4326;POINT(${s.lng} ${s.lat})`,
    cidade: 'Curitiba',
    pais: 'BR',
    bairro: s.bairro,
    endereco: s.endereco,
    tipo: 'PUBLICA',
    status: fase1Codes.has(s.codigo) ? 'ATIVO' : 'PLANEJADO',
  }));

  // Also add unmatched fase1 stations directly (they don't have codes in the main list)
  for (const u of unmatched) {
    const bairro = u.endereco.split(' - ').pop()?.trim() || '';
    rows.push({
      codigo: `CWB-F1-${String(u.num).padStart(3, '0')}`,
      geo: `SRID=4326;POINT(${u.lng} ${u.lat})`,
      cidade: 'Curitiba',
      pais: 'BR',
      bairro,
      endereco: u.endereco,
      tipo: 'PUBLICA',
      status: 'ATIVO',
    });
  }

  console.log(`\nTotal rows to insert: ${rows.length}`);
  console.log(`  ATIVO (fase 1): ${rows.filter(r => r.status === 'ATIVO').length}`);
  console.log(`  PLANEJADO: ${rows.filter(r => r.status === 'PLANEJADO').length}`);

  // 5. Insert in batches of 500 (upsert by codigo)
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await supaPost('/rest/v1/estacoes', batch);
    console.log(`Inserted batch ${Math.floor(i/BATCH)+1}/${Math.ceil(rows.length/BATCH)} (${batch.length} rows)`);
  }

  console.log('\nDone! All Curitiba stations inserted.');
}

main().catch(e => { console.error(e); process.exit(1); });
