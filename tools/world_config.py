"""Territory definitions for the Tacticle "World 1942" map.

This is an original division of the world for Tacticle. Geometry comes from
Natural Earth (public domain) admin-0 countries and admin-1 provinces; the
groupings, names, IPC values and spring-1942 owners below are Tacticle's own.

Source kinds (all lon values are "shifted": longitudes west of LON0 get +360):
  ('c', ISO)                 whole country (what is left after other claims)
  ('cb', ISO, bbox)          pieces of a country whose interior point is in bbox
  ('a', ISO, [names])        admin-1 provinces (only for countries in ADMIN1)
  ('ab', ISO, name, bbox)    pieces of one province whose interior point is in bbox
  ('ac', ISO, name, bbox)    one province cut to bbox (the rest stays for later claims)
  ('v', ISO, (lat, lon))     Voronoi share of what is left of ISO, around a seed
  ('circle', lat, lon, r)    a small round island (r in degrees)
bbox = (lon0, lat0, lon1, lat1)
"""

LON0 = -169.5          # map seam (Bering Strait); west of it wraps to the right edge
LAT_TOP, LAT_BOT = 76.0, -47.0
PX_PER_DEG = 10.0

# Countries whose provinces we use (Natural Earth 50m admin-1 coverage)
ADMIN1 = {'RUS', 'USA', 'CAN', 'CHN', 'IND', 'IDN', 'AUS', 'BRA', 'ZAF'}

POWERS = [
    # id, display name, team, colour
    ('Soviet Union', 'Soviet Union', 'Allies', '#a63a32'),
    ('Germany', 'Germany', 'Axis', '#5d6b73'),
    ('United Kingdom', 'United Kingdom', 'Allies', '#c9a96b'),
    ('Italy', 'Italy', 'Axis', '#8a6a48'),
    ('Japan', 'Japan', 'Axis', '#df8f31'),
    ('United States', 'United States', 'Allies', '#5a8447'),
    ('China', 'China', 'Allies', '#2f8a8f'),
    ('France', 'France', 'Allies', '#4767ad'),
]

SU, DE, UK, IT, JP, US, CN, FR, N = ('Soviet Union', 'Germany', 'United Kingdom', 'Italy',
                                    'Japan', 'United States', 'China', 'France', None)


def L(id, name, ipc, owner, src, capital=None, factory=False, island=0.0):
    return dict(id=id, name=name, ipc=ipc, owner=owner, src=src, capital=capital,
                factory=factory, island=island)


LAND = [
    # ---------------- Western & Northern Europe ----------------
    L('united_kingdom', 'United Kingdom', 8, UK, [('c', 'GBR'), ('c', 'IMN')], capital=UK, factory=True),
    L('ireland', 'Ireland', 1, N, [('c', 'IRL')]),
    L('iceland', 'Iceland', 0, UK, [('c', 'ISL')]),
    L('north_norway', 'Northern Norway', 1, DE, [('v', 'NOR', (68.6, 17.5))]),
    L('norway', 'Norway', 2, DE, [('v', 'NOR', (60.8, 9.0))]),
    L('sweden', 'Sweden', 2, N, [('c', 'SWE'), ('c', 'ALD')]),
    L('finland', 'Finland', 1, DE, [('c', 'FIN')]),
    L('denmark', 'Denmark', 1, DE, [('cb', 'DNK', (7, 54, 16, 58.5))]),
    L('netherlands', 'Netherlands', 1, DE, [('cb', 'NLD', (2, 50, 8, 54))]),
    L('belgium', 'Belgium', 1, DE, [('c', 'BEL'), ('c', 'LUX')]),
    L('northern_france', 'Northern France', 3, DE, [('v', 'FRA', (48.9, 1.6))]),
    L('southern_france', 'Southern France', 2, DE, [('v', 'FRA', (44.6, 3.2)), ('c', 'MCO')]),
    L('spain', 'Spain', 2, N, [('cb', 'ESP', (-10, 35, 5, 44.5)), ('c', 'AND'), ('c', 'GIB')]),
    L('portugal', 'Portugal', 1, N, [('cb', 'PRT', (-10, 36, -6, 43))]),
    L('switzerland', 'Switzerland', 1, N, [('c', 'CHE'), ('c', 'LIE')]),
    # ---------------- Central Europe ----------------
    L('germany_west', 'Western Germany', 4, DE, [('v', 'DEU', (50.4, 8.0))], factory=True),
    L('germany', 'Germany', 5, DE, [('v', 'DEU', (52.6, 12.8))], capital=DE, factory=True),
    L('east_prussia', 'East Prussia', 1, DE, [('a', 'RUS', ['Kaliningrad']), ('v', 'POL', (53.9, 21.6))]),
    L('poland', 'Poland', 2, DE, [('v', 'POL', (51.6, 19.0))]),
    L('austria', 'Austria', 2, DE, [('c', 'AUT')]),
    L('czechoslovakia', 'Czechoslovakia', 2, DE, [('c', 'CZE'), ('c', 'SVK')]),
    L('hungary', 'Hungary', 1, DE, [('c', 'HUN')]),
    L('romania', 'Romania', 2, DE, [('c', 'ROU'), ('c', 'MDA')]),
    L('bulgaria', 'Bulgaria', 1, DE, [('c', 'BGR')]),
    L('croatia', 'Croatia', 1, IT, [('c', 'HRV'), ('c', 'SVN'), ('c', 'BIH')]),
    L('serbia', 'Serbia', 1, DE, [('c', 'SRB'), ('c', 'KOS'), ('c', 'MNE'), ('c', 'MKD')]),
    L('albania', 'Albania', 0, IT, [('c', 'ALB')]),
    L('crete', 'Crete', 0, DE, [('cb', 'GRC', (23, 34.5, 26.6, 35.8))], island=0.3),
    L('greece', 'Greece', 1, DE, [('c', 'GRC')]),
    # ---------------- Italy ----------------
    L('sicily', 'Sicily', 1, IT, [('cb', 'ITA', (12, 36.4, 15.8, 38.4))]),
    L('sardinia', 'Sardinia', 0, IT, [('cb', 'ITA', (8, 38.7, 10, 41.4))]),
    L('northern_italy', 'Northern Italy', 2, IT, [('v', 'ITA', (45.3, 10.0)), ('c', 'SMR')], factory=True),
    L('italy', 'Italy', 3, IT, [('v', 'ITA', (41.2, 15.0)), ('c', 'VAT')], capital=IT, factory=True),
    L('malta', 'Malta', 0, UK, [('c', 'MLT'), ('circle', 35.9, 14.4, 0.3)], island=0.3),
    # ---------------- Soviet Union: west ----------------
    L('baltic_states', 'Baltic States', 1, DE, [('c', 'EST'), ('c', 'LVA'), ('c', 'LTU')]),
    L('belorussia', 'Belorussia', 2, DE, [('c', 'BLR')]),
    L('crimea', 'Crimea', 1, DE, [('a', 'RUS', ['Crimea', 'Sevastopol'])]),
    L('west_ukraine', 'Western Ukraine', 2, DE, [('v', 'UKR', (49.6, 27.5))]),
    L('ukraine', 'Ukraine', 2, DE, [('v', 'UKR', (48.6, 35.2))], factory=True),
    # Natural Earth 1:50m "Murmansk" covers both Kola and Karelia ("Karelia" is an islet),
    # so cut it at 66.4 N, about where the real border runs
    L('murmansk', 'Murmansk', 1, SU, [('ac', 'RUS', 'Murmansk', (25, 66.4, 45, 72))]),
    L('karelia', 'Karelia', 1, SU, [('a', 'RUS', ['Murmansk', 'Karelia'])]),
    L('leningrad', 'Leningrad', 2, SU, [('a', 'RUS', ['Leningrad', 'City of St. Petersburg', 'Novgorod', 'Pskov'])], factory=True),
    L('arkhangelsk', 'Arkhangelsk', 1, SU, [('a', 'RUS', ["Arkhangel'sk", 'Vologda', 'Nenets'])]),
    L('smolensk', 'Smolensk', 1, DE, [('a', 'RUS', ['Smolensk', 'Bryansk', 'Orel'])]),
    L('kursk', 'Kursk', 1, DE, [('a', 'RUS', ['Kursk', 'Belgorod'])]),
    L('moscow', 'Moscow', 6, SU, [('a', 'RUS', ['Moskva', 'Moskovskaya', "Tver'", 'Kaluga', 'Tula', "Ryazan'", "Yaroslavl'"])], capital=SU, factory=True),
    L('gorky', 'Gorky', 2, SU, [('a', 'RUS', ['Nizhegorod', 'Kostroma', 'Kirov', 'Mariy-El', 'Chuvash', 'Mordovia', 'Ivanovo', 'Vladimir'])]),
    L('voronezh', 'Voronezh', 1, SU, [('a', 'RUS', ['Voronezh', 'Lipetsk', 'Tambov'])]),
    L('volga', 'Volga', 2, SU, [('a', 'RUS', ['Tatarstan', 'Udmurt', "Ul'yanovsk", 'Samara', 'Saratov', 'Penza'])], factory=True),
    L('rostov', 'Rostov', 1, SU, [('a', 'RUS', ['Rostov'])]),
    L('stalingrad', 'Stalingrad', 2, SU, [('a', 'RUS', ['Volgograd', "Astrakhan'", 'Kalmyk'])], factory=True),
    L('caucasus', 'Caucasus', 3, SU, [('a', 'RUS', ['Krasnodar', 'Adygey', "Stavropol'", 'Karachay-Cherkess', 'Kabardin-Balkar',
                                                    'North Ossetia', 'Ingush', 'Chechnya', 'Dagestan'])]),
    L('transcaucasia', 'Transcaucasia', 2, SU, [('c', 'GEO'), ('c', 'ARM'), ('c', 'AZE')]),
    L('komi', 'Komi', 1, SU, [('a', 'RUS', ['Komi'])]),
    L('urals', 'Urals', 3, SU, [('a', 'RUS', ["Perm'", 'Sverdlovsk', 'Chelyabinsk', 'Bashkortostan', 'Orenburg', 'Kurgan'])], factory=True),
    # ---------------- Soviet Union: east ----------------
    L('ob_basin', 'Ob Basin', 0, SU, [('a', 'RUS', ['Khanty-Mansiy', 'Yamal-Nenets'])]),
    L('west_siberia', 'Western Siberia', 2, SU, [('a', 'RUS', ["Tyumen'", 'Omsk', 'Novosibirsk', 'Tomsk', 'Kemerovo', 'Altay', 'Gorno-Altay'])]),
    L('krasnoyarsk', 'Krasnoyarsk', 1, SU, [('a', 'RUS', ['Krasnoyarsk', 'Khakass', 'Tuva'])]),
    L('irkutsk', 'Irkutsk', 1, SU, [('a', 'RUS', ['Irkutsk', 'Buryat'])]),
    L('transbaikal', 'Transbaikal', 0, SU, [('a', 'RUS', ['Chita'])]),
    L('yakutia', 'Yakutia', 0, SU, [('a', 'RUS', ['Sakha (Yakutia)'])]),
    L('amur', 'Amur', 1, SU, [('a', 'RUS', ['Amur', 'Yevrey'])]),
    L('khabarovsk', 'Khabarovsk', 1, SU, [('a', 'RUS', ['Khabarovsk'])]),
    L('vladivostok', 'Vladivostok', 1, SU, [('a', 'RUS', ["Primor'ye"])]),
    L('kolyma', 'Kolyma', 0, SU, [('a', 'RUS', ['Maga Buryatdan'])]),
    L('kamchatka', 'Kamchatka', 0, SU, [('a', 'RUS', ['Kamchatka'])]),
    L('chukotka', 'Chukotka', 0, SU, [('a', 'RUS', ['Chukchi Autonomous Okrug'])]),
    L('sakhalin', 'Sakhalin', 0, SU, [('ac', 'RUS', 'Sakhalin', (141, 50.0, 145, 55))]),
    L('karafuto', 'Karafuto', 0, JP, [('a', 'RUS', ['Sakhalin'])]),
    L('west_kazakhstan', 'Western Kazakhstan', 1, SU, [('v', 'KAZ', (47.8, 56.0))]),
    L('kazakhstan', 'Kazakhstan', 1, SU, [('v', 'KAZ', (48.5, 72.0))]),
    L('turkestan', 'Turkestan', 1, SU, [('c', 'UZB'), ('c', 'TKM'), ('c', 'TJK'), ('c', 'KGZ')]),
    L('mongolia', 'Mongolia', 0, SU, [('c', 'MNG')]),
    # ---------------- Middle East ----------------
    L('turkey', 'Turkey', 2, N, [('c', 'TUR')]),
    L('cyprus', 'Cyprus', 0, UK, [('c', 'CYP'), ('c', 'CYN')], island=0.2),
    L('syria', 'Syria', 1, UK, [('c', 'SYR'), ('c', 'LBN')]),
    L('palestine', 'Palestine', 1, UK, [('c', 'ISR'), ('c', 'PSX'), ('c', 'JOR')]),
    L('iraq', 'Iraq', 2, UK, [('c', 'IRQ'), ('c', 'KWT')]),
    L('north_persia', 'Northern Persia', 1, SU, [('v', 'IRN', (36.0, 52.0))]),
    L('persia', 'Persia', 2, UK, [('v', 'IRN', (30.0, 55.5))]),
    L('arabia', 'Arabia', 1, N, [('c', 'SAU'), ('c', 'YEM'), ('c', 'OMN'), ('c', 'ARE'), ('c', 'QAT'), ('c', 'BHR')]),
    L('afghanistan', 'Afghanistan', 0, N, [('c', 'AFG')]),
    # ---------------- Africa ----------------
    L('egypt', 'Egypt', 2, UK, [('c', 'EGY')], factory=True),
    L('cyrenaica', 'Cyrenaica', 1, IT, [('v', 'LBY', (29.5, 21.5))]),
    L('tripolitania', 'Tripolitania', 1, IT, [('v', 'LBY', (29.5, 13.5))]),
    L('tunisia', 'Tunisia', 1, DE, [('c', 'TUN')]),
    L('algeria', 'Algeria', 1, DE, [('c', 'DZA')]),
    L('morocco', 'Morocco', 1, DE, [('c', 'MAR'), ('c', 'SAH')]),
    L('french_west_africa', 'French West Africa', 1, DE, [('c', c) for c in ('MRT', 'MLI', 'SEN', 'GMB', 'GIN', 'GNB', 'CIV', 'BFA', 'NER', 'BEN', 'TGO')]),
    L('british_west_africa', 'British West Africa', 1, UK, [('c', c) for c in ('NGA', 'GHA', 'SLE', 'LBR')]),
    L('french_equatorial_africa', 'French Equatorial Africa', 1, FR, [('c', c) for c in ('TCD', 'CAF', 'CMR', 'GAB', 'COG', 'GNQ', 'STP')], capital=FR),
    L('belgian_congo', 'Belgian Congo', 1, UK, [('c', 'COD'), ('c', 'RWA'), ('c', 'BDI')]),
    L('angola', 'Angola', 0, N, [('c', 'AGO')]),
    L('sudan', 'Sudan', 1, UK, [('c', 'SDN'), ('c', 'SDS')]),
    L('ethiopia', 'Ethiopia', 1, UK, [('c', 'ETH'), ('c', 'ERI')]),
    L('somaliland', 'Somaliland', 0, UK, [('c', 'SOM'), ('c', 'SOL'), ('c', 'DJI')]),
    L('east_africa', 'East Africa', 1, UK, [('c', 'KEN'), ('c', 'UGA'), ('c', 'TZA')]),
    L('rhodesia', 'Rhodesia', 1, UK, [('c', 'ZMB'), ('c', 'ZWE'), ('c', 'MWI')]),
    L('mozambique', 'Mozambique', 0, N, [('c', 'MOZ')]),
    L('southwest_africa', 'South-West Africa', 0, UK, [('c', 'NAM')]),
    L('south_africa', 'South Africa', 2, UK, [('c', 'ZAF'), ('c', 'LSO'), ('c', 'SWZ'), ('c', 'BWA')], factory=True),
    L('madagascar', 'Madagascar', 0, UK, [('c', 'MDG')]),
    # ---------------- South & Southeast Asia ----------------
    L('northwest_india', 'Northwest India', 2, UK, [('c', 'PAK'), ('a', 'IND', ['Jammu and Kashmir', 'Ladakh', 'Himachal Pradesh', 'Punjab', 'Chandigarh',
                                                                            'Haryana', 'Rajasthan', 'Gujarat', 'Dadra and Nagar Haveli and Daman and Diu'])]),
    L('india', 'India', 3, UK, [('a', 'IND', ['Delhi', 'Uttar Pradesh', 'Uttarakhand', 'Madhya Pradesh', 'Bihar', 'Jharkhand', 'Chhattisgarh', 'Maharashtra']),
                                ('c', 'NPL')], factory=True),
    L('bengal', 'Bengal', 2, UK, [('a', 'IND', ['West Bengal', 'Odisha', 'Assam', 'Meghalaya', 'Tripura', 'Mizoram', 'Manipur', 'Nagaland',
                                                'Arunachal Pradesh', 'Sikkim']), ('c', 'BGD'), ('c', 'BTN')]),
    L('south_india', 'Southern India', 2, UK, [('a', 'IND', ['Telangana', 'Andhra Pradesh', 'Karnataka', 'Goa', 'Kerala', 'Tamil Nadu', 'Puducherry', 'Lakshadweep'])]),
    L('andaman_islands', 'Andaman Islands', 0, JP, [('a', 'IND', ['Andaman and Nicobar'])], island=0.25),
    L('ceylon', 'Ceylon', 1, UK, [('c', 'LKA')]),
    L('burma', 'Burma', 1, JP, [('c', 'MMR')]),
    L('siam', 'Siam', 1, JP, [('c', 'THA')]),
    L('indochina', 'French Indochina', 2, JP, [('c', 'VNM'), ('c', 'LAO'), ('c', 'KHM')]),
    L('malaya', 'Malaya', 1, JP, [('cb', 'MYS', (99, 0, 105, 7.5)), ('c', 'SGP')]),
    L('borneo', 'Borneo', 2, JP, [('c', 'MYS'), ('c', 'BRN'), ('a', 'IDN', ['Kalimantan Barat', 'Kalimantan Tengah', 'Kalimantan Selatan', 'Kalimantan Timur'])]),
    L('sumatra', 'Sumatra', 2, JP, [('a', 'IDN', ['Aceh', 'Sumatera Utara', 'Riau', 'Sumatera Barat', 'Jambi', 'Bengkulu', 'Sumatera Selatan',
                                                 'Lampung', 'Bangka-Belitung', 'Kepulauan Riau'])]),
    L('java', 'Java', 2, JP, [('a', 'IDN', ['Banten', 'Jakarta Raya', 'Jawa Barat', 'Jawa Tengah', 'Yogyakarta', 'Jawa Timur', 'Bali', 'Nusa Tenggara Barat'])]),
    L('celebes', 'Celebes', 1, JP, [('a', 'IDN', ['Sulawesi Selatan', 'Sulawesi Barat', 'Sulawesi Tengah', 'Sulawesi Tenggara', 'Sulawesi Utara',
                                                 'Gorontalo', 'Maluku', 'Maluku Utara'])]),
    L('timor', 'Timor', 0, JP, [('a', 'IDN', ['Nusa Tenggara Timur']), ('c', 'TLS')]),
    L('dutch_new_guinea', 'Dutch New Guinea', 0, JP, [('a', 'IDN', ['Papua', 'Papua Barat'])]),
    L('new_britain', 'New Britain', 0, JP, [('cb', 'PNG', (148, -7, 153.8, -1.5))]),
    L('solomons', 'Solomon Islands', 0, JP, [('c', 'SLB'), ('cb', 'PNG', (154, -7.5, 157, -4.5))], island=0.25),
    L('new_guinea', 'New Guinea', 1, UK, [('c', 'PNG')]),
    L('luzon', 'Luzon', 1, US, [('v', 'PHL', (16.0, 121.0))]),
    L('mindanao', 'Mindanao', 1, US, [('v', 'PHL', (8.0, 124.8))]),
    # ---------------- China & Japan ----------------
    L('manchuria', 'Manchuria', 2, JP, [('a', 'CHN', ['Heilongjiang', 'Jilin', 'Liaoning'])], factory=True),
    L('inner_mongolia', 'Inner Mongolia', 0, JP, [('a', 'CHN', ['Inner Mongol'])]),
    L('north_china', 'North China', 2, JP, [('a', 'CHN', ['Beijing', 'Tianjin', 'Hebei', 'Shanxi', 'Shandong'])]),
    L('shanghai', 'Shanghai', 2, JP, [('a', 'CHN', ['Jiangsu', 'Shanghai', 'Zhejiang', 'Anhui'])]),
    L('central_china', 'Central China', 1, CN, [('a', 'CHN', ['Henan', 'Hubei', 'Hunan'])]),
    L('fujian', 'Fujian', 1, CN, [('a', 'CHN', ['Fujian', 'Jiangxi'])]),
    L('guangdong', 'Guangdong', 1, JP, [('a', 'CHN', ['Guangdong', 'Guangxi', 'Hainan']), ('c', 'HKG'), ('c', 'MAC')]),
    L('sichuan', 'Sichuan', 2, CN, [('a', 'CHN', ['Sichuan', 'Chongqing'])], capital=CN),
    L('yunnan', 'Yunnan', 1, CN, [('a', 'CHN', ['Yunnan', 'Guizhou'])]),
    L('shaanxi', 'Shaanxi', 1, CN, [('a', 'CHN', ['Shaanxi', 'Gansu', 'Ningxia'])]),
    L('xinjiang', 'Xinjiang', 0, CN, [('a', 'CHN', ['Xinjiang'])]),
    L('tibet', 'Tibet', 0, N, [('a', 'CHN', ['Xizang', 'Qinghai'])]),
    L('formosa', 'Formosa', 1, JP, [('c', 'TWN')]),
    L('korea', 'Korea', 2, JP, [('c', 'PRK'), ('c', 'KOR')]),
    L('okinawa', 'Okinawa', 0, JP, [('cb', 'JPN', (122, 24, 131.5, 29.6))], island=0.2),
    L('hokkaido', 'Hokkaido', 1, JP, [('cb', 'JPN', (139.3, 41.6, 146.5, 46))]),
    L('kyushu', 'Kyushu', 1, JP, [('cb', 'JPN', (128.5, 30.8, 132.2, 34.0))]),
    L('japan', 'Japan', 8, JP, [('c', 'JPN')], capital=JP, factory=True),
    L('iwo_jima', 'Iwo Jima', 0, JP, [('circle', 24.8, 141.3, 0.35)], island=0.0),
    # ---------------- Pacific islands ----------------
    L('marianas', 'Marianas', 0, JP, [('c', 'GUM'), ('c', 'MNP')], island=0.3),
    L('caroline_islands', 'Caroline Islands', 0, JP, [('c', 'FSM'), ('c', 'PLW'), ('circle', 7.4, 151.8, 0.3)], island=0.25),
    L('marshall_islands', 'Marshall Islands', 0, JP, [('c', 'MHL'), ('circle', 8.7, 167.7, 0.3)], island=0.25),
    L('wake_island', 'Wake Island', 0, JP, [('circle', 19.3, 166.6, 0.35)]),
    L('gilbert_islands', 'Gilbert Islands', 0, JP, [('cb', 'KIR', (172, -3, 178, 4)), ('circle', 1.4, 173.0, 0.3)], island=0.25),
    L('midway', 'Midway', 0, US, [('circle', 28.2, 182.6, 0.35)]),
    L('hawaii', 'Hawaii', 1, US, [('a', 'USA', ['Hawaii'])], factory=True, island=0.35),
    L('samoa', 'Samoa', 0, US, [('c', 'WSM'), ('c', 'ASM')], island=0.3),
    L('fiji', 'Fiji', 0, UK, [('c', 'FJI')], island=0.25),
    L('new_hebrides', 'New Hebrides', 0, UK, [('c', 'VUT')], island=0.25),
    L('new_caledonia', 'New Caledonia', 0, FR, [('c', 'NCL')], island=0.15),
    L('new_zealand', 'New Zealand', 2, UK, [('c', 'NZL')]),
    # ---------------- Australia ----------------
    L('western_australia', 'Western Australia', 1, UK, [('a', 'AUS', ['Western Australia'])]),
    L('northern_australia', 'Northern Australia', 1, UK, [('a', 'AUS', ['Northern Territory'])]),
    L('queensland', 'Queensland', 1, UK, [('a', 'AUS', ['Queensland'])]),
    L('south_australia', 'South Australia', 1, UK, [('a', 'AUS', ['South Australia'])]),
    L('eastern_australia', 'Eastern Australia', 2, UK, [('a', 'AUS', ['New South Wales', 'Australian Capital Territory', 'Jervis Bay Territory',
                                                                      'Victoria', 'Tasmania'])], factory=True),
    # ---------------- North America ----------------
    L('alaska', 'Alaska', 1, US, [('ab', 'USA', 'Alaska', (-169.5, 50, -129, 72))]),
    L('aleutians', 'Aleutian Islands', 0, US, [('a', 'USA', ['Alaska'])], island=0.25),
    L('pacific_coast', 'Pacific Coast', 4, US, [('a', 'USA', ['Washington', 'Oregon', 'California', 'Nevada'])], factory=True),
    L('rocky_mountains', 'Rocky Mountains', 1, US, [('a', 'USA', ['Idaho', 'Montana', 'Wyoming', 'Utah', 'Colorado', 'Arizona', 'New Mexico'])]),
    L('great_plains', 'Great Plains', 2, US, [('a', 'USA', ['North Dakota', 'South Dakota', 'Nebraska', 'Kansas', 'Oklahoma', 'Minnesota', 'Iowa'])]),
    L('texas', 'Texas', 2, US, [('a', 'USA', ['Texas', 'Louisiana', 'Arkansas'])]),
    L('midwest', 'Midwest', 4, US, [('a', 'USA', ['Wisconsin', 'Michigan', 'Illinois', 'Indiana', 'Ohio', 'Missouri', 'Kentucky'])], factory=True),
    L('southeast_us', 'Southeastern States', 2, US, [('a', 'USA', ['Mississippi', 'Alabama', 'Georgia', 'Florida', 'South Carolina', 'Tennessee', 'North Carolina'])]),
    L('eastern_us', 'Eastern United States', 5, US, [('a', 'USA', ['Virginia', 'West Virginia', 'Maryland', 'Delaware', 'District of Columbia',
                                                                   'Pennsylvania', 'New Jersey', 'New York'])], capital=US, factory=True),
    L('new_england', 'New England', 2, US, [('a', 'USA', ['Connecticut', 'Rhode Island', 'Massachusetts', 'Vermont', 'New Hampshire', 'Maine'])]),
    L('british_columbia', 'British Columbia', 1, UK, [('a', 'CAN', ['British Columbia', 'Yukon'])]),
    L('prairies', 'Prairie Provinces', 1, UK, [('a', 'CAN', ['Alberta', 'Saskatchewan', 'Manitoba'])]),
    L('ontario', 'Ontario', 2, UK, [('a', 'CAN', ['Ontario'])]),
    L('quebec', 'Quebec', 1, UK, [('a', 'CAN', ['Québec'])]),
    L('maritimes', 'Maritime Provinces', 1, UK, [('a', 'CAN', ['New Brunswick', 'Nova Scotia', 'Prince Edward Island']), ('c', 'SPM')]),
    L('newfoundland', 'Newfoundland', 1, UK, [('a', 'CAN', ['Newfoundland and Labrador'])]),
    L('northern_canada', 'Northern Canada', 0, UK, [('a', 'CAN', ['Northwest Territories', 'Nunavut'])]),
    L('greenland', 'Greenland', 0, US, [('c', 'GRL')]),
    L('mexico', 'Mexico', 1, US, [('c', 'MEX')]),
    L('central_america', 'Central America', 1, US, [('c', c) for c in ('GTM', 'BLZ', 'SLV', 'HND', 'NIC', 'CRI', 'PAN')]),
    L('cuba', 'Cuba', 1, US, [('c', 'CUB'), ('c', 'CYM')]),
    L('west_indies', 'West Indies', 1, UK, [('c', c) for c in ('JAM', 'HTI', 'DOM', 'PRI', 'BHS', 'TCA', 'TTO', 'VIR', 'VGB', 'AIA', 'MAF',
                                                               'SXM', 'BLM', 'KNA', 'ATG', 'MSR', 'DMA', 'LCA', 'VCT', 'GRD', 'BRB',
                                                               'ABW', 'CUW')]),
    L('bermuda', 'Bermuda', 0, UK, [('c', 'BMU'), ('circle', 32.3, -64.8, 0.3)]),
    # ---------------- South America ----------------
    L('colombia', 'Colombia', 1, N, [('c', 'COL'), ('c', 'ECU')]),
    L('venezuela', 'Venezuela', 1, N, [('c', 'VEN')]),
    L('guianas', 'Guianas', 0, UK, [('c', 'GUY'), ('c', 'SUR'), ('cb', 'FRA', (-55, 1.5, -51, 6.5))]),
    L('peru', 'Peru', 1, N, [('c', 'PER'), ('c', 'BOL')]),
    L('amazonia', 'Amazonia', 0, N, [('a', 'BRA', ['Acre', 'Rondônia', 'Roraima', 'Amazonas', 'Pará', 'Amapá', 'Mato Grosso', 'Tocantins', 'Maranhão'])]),
    L('brazilian_bulge', 'Brazilian Bulge', 1, N, [('a', 'BRA', ['Piauí', 'Ceará', 'Rio Grande do Norte', 'Paraíba', 'Pernambuco', 'Alagoas', 'Sergipe', 'Bahia'])]),
    L('southern_brazil', 'Southern Brazil', 2, N, [('a', 'BRA', ['Mato Grosso do Sul', 'Paraná', 'Distrito Federal', 'Goiás', 'São Paulo', 'Rio de Janeiro',
                                                              'Minas Gerais', 'Espírito Santo', 'Santa Catarina', 'Rio Grande do Sul'])]),
    L('argentina', 'Argentina', 2, N, [('c', 'ARG'), ('c', 'URY'), ('c', 'PRY')]),
    L('chile', 'Chile', 0, N, [('c', 'CHL')]),
]

# Sea zones: Voronoi cells around these points, clipped to open water.
SEA = [
    # Arctic & North Atlantic
    ('barents_sea', 'Barents Sea', (72.5, 40.0)),
    ('kara_sea', 'Kara Sea', (73.5, 66.0)),
    ('norwegian_sea', 'Norwegian Sea', (68.0, 4.0)),
    ('greenland_sea', 'Greenland Sea', (72.0, -12.0)),
    ('denmark_strait', 'Denmark Strait', (64.0, -30.0)),
    ('north_sea', 'North Sea', (56.0, 3.0)),
    ('baltic_sea', 'Baltic Sea', (56.0, 18.0)),
    ('gulf_of_bothnia', 'Gulf of Bothnia', (62.5, 20.0)),
    ('english_channel', 'English Channel', (50.0, -2.5)),
    ('western_approaches', 'Western Approaches', (52.0, -12.5)),
    ('north_atlantic', 'North Atlantic', (57.0, -27.0)),
    ('bay_of_biscay', 'Bay of Biscay', (45.5, -5.0)),
    ('iberian_coast', 'Iberian Coast', (39.5, -13.0)),
    ('azores', 'Azores Waters', (38.0, -30.0)),
    ('labrador_sea', 'Labrador Sea', (58.0, -54.0)),
    ('baffin_bay', 'Baffin Bay', (70.0, -64.0)),
    ('hudson_bay', 'Hudson Bay', (59.5, -86.0)),
    ('gulf_of_st_lawrence', 'Gulf of St. Lawrence', (48.5, -61.5)),
    ('grand_banks', 'Grand Banks', (45.0, -47.0)),
    ('eastern_seaboard', 'Eastern Seaboard', (38.0, -70.5)),
    ('sargasso_sea', 'Sargasso Sea', (30.0, -58.0)),
    ('gulf_of_mexico', 'Gulf of Mexico', (25.0, -90.0)),
    ('caribbean_sea', 'Caribbean Sea', (15.0, -76.0)),
    ('lesser_antilles', 'Lesser Antilles', (16.0, -56.0)),
    ('central_atlantic', 'Central Atlantic', (28.0, -40.0)),
    ('canary_basin', 'Canary Basin', (29.0, -18.0)),
    ('cape_verde', 'Cape Verde Waters', (15.0, -25.0)),
    ('equatorial_atlantic', 'Equatorial Atlantic', (3.0, -28.0)),
    ('gulf_of_guinea', 'Gulf of Guinea', (1.5, 2.0)),
    ('guinea_coast', 'Guinea Coast', (5.0, -14.0)),
    ('brazilian_coast', 'Brazilian Coast', (-8.0, -31.0)),
    ('santos_basin', 'Santos Basin', (-27.0, -42.0)),
    ('argentine_basin', 'Argentine Basin', (-40.0, -52.0)),
    ('south_atlantic', 'South Atlantic', (-25.0, -15.0)),
    ('angola_basin', 'Angola Basin', (-13.0, 6.0)),
    ('cape_of_good_hope', 'Cape of Good Hope', (-37.0, 18.0)),
    # Mediterranean & Black Sea
    ('western_mediterranean', 'Western Mediterranean', (38.5, 3.5)),
    ('tyrrhenian_sea', 'Tyrrhenian Sea', (40.0, 12.0)),
    ('central_mediterranean', 'Central Mediterranean', (34.6, 16.0)),
    ('adriatic_sea', 'Adriatic Sea', (42.8, 16.0)),
    ('ionian_sea', 'Ionian Sea', (37.8, 19.0)),
    ('aegean_sea', 'Aegean Sea', (38.6, 25.0)),
    ('eastern_mediterranean', 'Eastern Mediterranean', (33.4, 30.5)),
    ('black_sea', 'Black Sea', (43.2, 34.0)),
    # Indian Ocean
    ('red_sea', 'Red Sea', (20.0, 38.5)),
    ('gulf_of_aden', 'Gulf of Aden', (12.6, 48.5)),
    ('somali_basin', 'Somali Basin', (1.0, 52.0)),
    ('mozambique_channel', 'Mozambique Channel', (-18.0, 41.0)),
    ('mascarene_sea', 'Mascarene Sea', (-22.0, 58.0)),
    ('persian_gulf', 'Persian Gulf', (27.0, 51.5)),
    ('arabian_sea', 'Arabian Sea', (15.0, 63.0)),
    ('laccadive_sea', 'Laccadive Sea', (6.5, 75.0)),
    ('bay_of_bengal', 'Bay of Bengal', (15.0, 88.0)),
    ('andaman_sea', 'Andaman Sea', (8.5, 96.5)),
    ('central_indian_ocean', 'Central Indian Ocean', (-10.0, 78.0)),
    ('southern_indian_ocean', 'Southern Indian Ocean', (-36.0, 82.0)),
    ('west_australian_basin', 'West Australian Basin', (-27.0, 106.0)),
    ('great_australian_bight', 'Great Australian Bight', (-38.0, 132.0)),
    # Southeast Asia & Australia
    ('java_sea', 'Java Sea', (-5.0, 111.0)),
    ('timor_sea', 'Timor Sea', (-11.5, 125.0)),
    ('arafura_sea', 'Arafura Sea', (-10.0, 137.0)),
    ('banda_sea', 'Banda Sea', (-5.5, 128.0)),
    ('celebes_sea', 'Celebes Sea', (5.0, 121.5)),
    ('gulf_of_siam', 'Gulf of Siam', (9.0, 102.0)),
    ('south_china_sea', 'South China Sea', (13.0, 114.0)),
    ('coral_sea', 'Coral Sea', (-17.0, 154.0)),
    ('solomon_sea', 'Solomon Sea', (-9.0, 158.5)),
    ('bismarck_sea', 'Bismarck Sea', (-2.5, 147.0)),
    ('tasman_sea', 'Tasman Sea', (-37.0, 160.0)),
    ('new_hebrides_basin', 'New Hebrides Basin', (-19.0, 168.0)),
    # North & West Pacific
    ('philippine_sea', 'Philippine Sea', (17.0, 131.0)),
    ('east_china_sea', 'East China Sea', (29.0, 125.0)),
    ('yellow_sea', 'Yellow Sea', (36.0, 123.0)),
    ('sea_of_japan', 'Sea of Japan', (40.0, 135.0)),
    ('sea_of_okhotsk', 'Sea of Okhotsk', (54.0, 148.0)),
    ('kuroshio', 'Kuroshio Current', (32.0, 143.0)),
    ('kuril_basin', 'Kuril Basin', (45.0, 158.0)),
    ('mariana_basin', 'Mariana Basin', (16.0, 151.0)),
    ('caroline_basin', 'Caroline Basin', (4.5, 147.0)),
    ('marshall_basin', 'Marshall Basin', (8.0, 170.0)),
    ('wake_basin', 'Wake Basin', (21.0, 165.0)),
    ('gilbert_basin', 'Gilbert Basin', (-2.0, 178.0)),
    ('fiji_basin', 'Fiji Basin', (-19.0, 180.5)),
    ('samoa_basin', 'Samoa Basin', (-11.0, 189.0)),
    ('new_zealand_waters', 'New Zealand Waters', (-42.0, 178.0)),
    ('midway_waters', 'Midway Waters', (29.0, 180.0)),
    ('bering_sea', 'Bering Sea', (58.0, 182.0)),
    ('chukchi_sea', 'Chukchi Sea', (71.0, 186.0)),
    ('north_pacific', 'North Pacific', (45.0, 185.0)),
    # East Pacific
    ('beaufort_sea', 'Beaufort Sea', (72.5, -140.0)),
    ('gulf_of_alaska', 'Gulf of Alaska', (55.0, -146.0)),
    ('hawaiian_waters', 'Hawaiian Waters', (21.0, -156.0)),
    ('central_pacific', 'Central Pacific', (35.0, -158.0)),
    ('northeast_pacific', 'Northeast Pacific', (44.0, -136.0)),
    ('california_coast', 'California Coast', (31.0, -124.0)),
    ('line_islands', 'Line Islands', (4.0, -158.0)),
    ('eastern_pacific', 'Eastern Pacific', (12.0, -110.0)),
    ('panama_approaches', 'Panama Approaches', (4.0, -86.0)),
    ('humboldt_current', 'Humboldt Current', (-20.0, -82.0)),
    ('south_pacific', 'South Pacific', (-25.0, -125.0)),
    ('polynesia', 'Polynesia', (-17.0, -152.0)),
]

# Extra connections. Straits connect sea zones the 1:50m coastline closes; canals need
# the listed land territories to be friendly to the moving power.
SEA_LINKS = [
    ('black_sea', 'aegean_sea'),               # Bosporus and Dardanelles
    ('western_mediterranean', 'iberian_coast'),  # Strait of Gibraltar
]
CANALS = [
    dict(id='suez', name='Suez Canal', a='eastern_mediterranean', b='red_sea', requires=['egypt']),
    dict(id='panama', name='Panama Canal', a='caribbean_sea', b='panama_approaches', requires=['central_america']),
]
LAND_LINKS = [
    ('sicily', 'italy'),                      # Strait of Messina
    ('kyushu', 'japan'),                      # Kanmon Strait
    ('denmark', 'sweden'),                    # Oresund
]
# Pairs that touch only because of the small-island buffers or a single point
NOT_ADJACENT = [
    ('egypt', 'arabia'),                      # Gulf of Aqaba
]
