# 원인
Jackson을 이용하여 DTO를 문자열로 직렬화 하는 도중에 InvalidDefinitionException이 발생함.  

```text
Java 8 date/time type `java.time.LocalDateTime` not supported by default: add Module "com.fasterxml.jackson.datatype:jackson-datatype-jsr310" to enable handling..
```

Java8의 날짜/시간 타입을 지원하지 않는다고 한다.

# 해결
```java

@Bean
ObjectMapper objectMapper() {
  ObjectMapper objectMapper = new ObjectMapper();
  // 추가
  objectMapper.registerModule(new JavaTimeModule());

  return objectMapper;
}
```

JavaTimeModule을 등록해주면 해결된다.  
JavaTimeModule 클래스가 검색되지 않는다면 build.gradle에 jsr310 모듈을 추가하자.  
```groovy
  implementation 'com.fasterxml.jackson.core:jackson-databind:2.15.3'
  implementation 'com.fasterxml.jackson.datatype:jackson-datatype-jsr310:2.15.3'
```