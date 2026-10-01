-- 가상 MES/ERP 기준정보
-- 자동 생성 파일 — scripts/db/generate-seed.mjs 수정 후 npm run db:seed 로 재생성


INSERT INTO cm010 (cd_id, cd_nm, cd_desc) VALUES
('EG10', '가공 설비군', '부품 가공·성형 설비'),
('EG20', '후처리 설비군', '가공품 세정·표면 처리 설비'),
('EG30', '시험 설비군', '완성품 환경 시험 설비'),
('NG01', '치수 불량', '가공 치수 공차 이탈'),
('NG02', '조립 누락', '구성 부품 누락·미체결'),
('NG03', '외관 불량', '표면 얼룩·변색·흠집'),
('NG04', '접합 불량', '접합부 결합력 부족'),
('NG05', '이물 잔류', '후처리 후 이물·오염 잔류');

INSERT INTO bp100 (bp_cd, bp_nm, bp_tp, tel_no) VALUES
('CUST-CA', '고객사 A', '수요처', '000-0000-0001'),
('CUST-CB', '고객사 B', '수요처', '000-0000-0002'),
('CUST-CC', '고객사 C', '수요처', '000-0000-0003'),
('CUST-SA', '공급사 A(자재공급)', '공급처', '000-0000-0004'),
('CUST-SB', '공급사 B(자재공급)', '공급처', '000-0000-0005');

INSERT INTO mdl100 (mdl_cd, mdl_nm, mdl_spec) VALUES
('MA', '제어 모듈 A형', '120x80x30mm 알루미늄 하우징 조립체'),
('MB', '구동 유닛 B형', '150x100x60mm 강판 프레임 조립체');

INSERT INTO it100 (itm_cd, itm_nm, itm_spec, bp_cd, mdl_cd) VALUES
('P2101-00', '제어 모듈 하우징', 'AL6061 120x80', 'CUST-CA', 'MA'),
('P2102-00', '제어 모듈 커버', 'AL6061 120x80 t2', 'CUST-CA', 'MA'),
('P3101-00', '구동 유닛 브래킷', 'SPCC t3.2', 'CUST-CC', 'MB'),
('P3102-00', '구동 유닛 베이스', 'SPCC t4.5', 'CUST-CB', 'MB');

INSERT INTO eq100 (eq_cd, eq_nm, ln_cd, eq_tp, loc_nm) VALUES
('M-101', '가공기 1호기', 'L01', 'EG10', '1공장 가공동'),
('F-101', '후처리기 1호기', 'L01', 'EG20', '1공장 후처리동'),
('M-201', '가공기 2호기', 'L02', 'EG10', '1공장 가공동'),
('F-201', '후처리기 2호기', 'L02', 'EG20', '1공장 후처리동'),
('T-301', '환경 시험기 1호기', 'L03', 'EG30', '2공장 시험동');

INSERT INTO eq110 (mi_cd, mi_nm, unit) VALUES
('TMP', '온도', '℃'),
('HUM', '습도', '%'),
('PRS', '압력', 'bar'),
('VIB', '진동', 'mm/s'),
('AMP', '부하 전류', 'A');

INSERT INTO eq120 (eq_tp, mi_cd, lo_lmt, hi_lmt) VALUES
('EG10', 'HUM', NULL, 60),
('EG10', 'VIB', NULL, 7.1),
('EG20', 'PRS', 3, NULL);

INSERT INTO hr100 (emp_id, emp_nm, dept_nm, shift_cd) VALUES
('EMP001', '박지훈', '생산기술부', 'A조'),
('EMP002', '윤서준', '품질보증팀', 'B조'),
('EMP003', '한동욱', '생산기술부', 'B조'),
('EMP004', '최유진', '품질보증팀', 'A조'),
('EMP005', '정수아', '생산기술부', 'A조');
