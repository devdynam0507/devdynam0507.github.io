유저의 미션 시스템을 구현 중 일명 '따닥' 이슈를 막아야하는 기능이 있어  
동시에 들어온 요청에 대해 1개만 처리 할 수 있는 기능을 개발중이다.  
이 처리를 하지 않는다면 보상이 n번 지급되어 문제가 생길 수 있다.  

이러한 경우에 분산락을 이용하여 공유 자원에 대한 잠금 처리를 할 수 있게되는데, 분산락을 구현하는 방법은 여러가지가 있다.  
Redis, Zookeeper등을 이용하여 분산락을 구현할 수 있지만 운영 환경에서 추가 리소스를 들여야한다는 단점이 존재한다.  
지금 구현중인 서비스의 경우 단순 3-tier 아키텍처로 런칭을 할 계획이고 필요한 시점에 Redis Cache를 추가할 예정인데.  
아직까지는 Redis를 사용할 이유가 없어 MySQL에서 NamedLock을 이용한 분산락을 구현하기로 결정하였다.  
NamedLock은 MySQL에만 있는 기능이기때문에 어떠한 이유로 Locking에 대한 구현을 바꿀 경우를 대비하여 구현해야 한다.  

### 현재 구현해야할 기능 스펙은 다음과 같다.  
1. t1 ~ t2 사이에 이미 미션을 수행했는지 검사한다.
2. 미션을 수행하지 않았다면 미션 결과를 데이터베이스에 저장한다.  
3. 보상을 지급한다.  

위 기능에서 동시성처리를 하지 않았을 때 발생할 수 있는 문제 시나리오는 다음과 같다.  
### 시나리오
-- 클라이언트
1. 동시에 여러개의 요청을 보낸다.  
-- 서버
2. 동시에 여러개의 요청이 도착한다.
3. 동시에 트랜잭션이 시작된다.  
4. 동시에 시작된 트랜잭션은 t1~t2 사이에 이미 미션을 수행했는지 검사하지만 아직 생성된 데이터가 없으므로 통과한다.  
5. 열려있는 모든 트랜잭션이 미션 수행 처리를 한다.

**결과적으로 동시에 요청 보낸 모든 미션이 수행되어있고 중복으로 보상이 지급된다.**  
우리는 제일 먼저 도착한 요청 한 개만 처리해야하고 나머지 요청은 이미 처리 완료된 미션이라는 예외를 던져야 한다.  
구현에 들어가기전에 [NamedLock](https://dev.mysql.com/doc/refman/8.3/en/locking-functions.html)에 대해 알아보자.  

### NameedLock MySQL 함수
| 함수이름 | 설명   |
|-------|------|
| GET_LOCK(str, timeout) | str 이름으로 Lock 얻기, 이미 점유중이라면 timeout 초만큼 기다린다. |
| IS_FREE_LOCK(str) | str 이름의 Lock을 얻을 수 있는지 여부, 1 => Lock 사용 가능, 0 => Lock 사용 불가, NULL => 오류가 발생한 경우 (e.g 잘못된 인자 등) |
| IS_USED_LOCK(str) | str 이름의 Lock 이미 사용중인지 확인하는 함수, 사용중이라면 사용중인 클라이언트의 식별자를 반환한다. 그렇지 않다면 NULL 반환 |
| RELEASE_ALL_LOCKS() | 모든 Lock을 해제하고 해제된 Lock 수를 반환한다. |
| RELEASE_LOCK(str) | str 이름의 Lock을 해제한다. 해제된 경우 1 반환, 스레드에 의해 Lock이 설정되어있지 않은 경우 0 반환, 명명된 Lock이 존재하지 않은 경우 |

여기서 GET_LOCK과 RELEASE_LOCK을 이용하여 분산락을 구현할 것이다.  
### GET_LOCK(str, timeout) 주요 내용 정리
- GET_LOCK으로 Lock 획득 시 performance_schema.metadata_locks 테이블에 Lock 정보가 저장된다.  
- 버전 8.3의 경우 Lock 이름은 최대 64자 까지 허용한다.
- 애플리케이션 Lock을 구현하거나 레코드 Lock을 시뮬레이션하는 데 사용할 수 있다.
- Lock은 단일 mysql에만 지원하므로 MySQL 클러스터를 사용한다면 NamedLock은 적합하지 않다.  

### NamedLock을 이용하여 Spring Application 동시성 처리 구현
> 구현은 [배민기술블로그](https://techblog.woowahan.com/2631/) 를 참고하여 구현하였습니다.  

구현전 고려해야할 사항이 있다.  
1. 서비스가 커져서 Locking 구현 벤더를 변경해야한다면? 
2. 미션 기능의 경우 계속 추가될 수 있으니 필요한곳에서 유연하게 Lock을 적용해야 한다.  
2-1. 모든 미션의 경우 동일하게 안정적인 동시성 로직이 보장되어야 한다.

따라서
1. 유연하게 Lock 전략을 변경할 수 있도록 구현한다.
2. AOP를 이용하여 횡단관심 공통로직을 구현한다.  

아래 NamedLockRepository 인터페이스를 한 개 만든다.  
```java
public interface NamedLockRepository {

    void lock(String lockName, int timeout);

    void releaseLock(String lockName);
}
```

NameLockRepository를 구현한다.  
DataSource를 주입받아 사용한다.  
```java
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

import javax.sql.DataSource;

import lombok.extern.slf4j.Slf4j;

@Slf4j
public class NamedLockRepositoryImpl implements NamedLockRepository {

    private static final String GET_LOCK_SQL = "SELECT GET_LOCK(?, ?)";
    private static final String RELEASE_LOCK_SQL = "SELECT RELEASE_LOCK(?)";

    private final DataSource dataSource;

    public NamedLockRepositoryImpl(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @Override
    public void lock(String lockName, int timeout) {
        try (Connection connection = dataSource.getConnection()) {
            try (PreparedStatement preparedStatement = connection.prepareStatement(GET_LOCK_SQL)) {
                preparedStatement.setString(1, lockName);
                preparedStatement.setInt(2, timeout);
                try (ResultSet resultSet = executeAndGet(preparedStatement)) {
                    assertsLockQueryResult(resultSet, lockName + " Lock을 획득할 수 없습니다.");
                }
            }
        } catch (SQLException | RuntimeException e) {
            e.printStackTrace();
            throw new RuntimeException(e.getMessage(), e);
        }
    }

    @Override
    public void releaseLock(String lockName) {
        try (Connection connection = dataSource.getConnection()) {
            log.info("connection: {}", connection);
            try (PreparedStatement preparedStatement = connection.prepareStatement(RELEASE_LOCK_SQL)) {
                preparedStatement.setString(1, lockName);

                try (ResultSet resultSet = executeAndGet(preparedStatement)) {
                    assertsLockQueryResult(resultSet, lockName + " Lock을 해제할 수 없습니다.");
                }
            }
        } catch (SQLException | RuntimeException e) {
            e.printStackTrace();
            throw new RuntimeException(e.getMessage(), e);
        }
    }

    private ResultSet executeAndGet(PreparedStatement preparedStatement) throws SQLException {
       ResultSet resultSet = preparedStatement.executeQuery();
       if (!resultSet.next()) {
           throw new LockingException("Lock 쿼리 결과값이 존재하지 않습니다.");
       }

       return resultSet;
    }

    private void assertsLockQueryResult(ResultSet resultSet, String message) throws SQLException {
        int result = resultSet.getInt(1);
        if (result != 1) {
            throw new LockingException(message);
        }
    }
}
```
AOP로 활용할 어노테이션을 하나 만든다.  
```java
package com.marshmallow.app.annotations;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface ActivityAction {
}
```

NamedLock을 이용한 AOP를 구현한다.  
대상 메소드 조인포인트 실행 전 유저 아이디로 namedlock을 획득하고 조인포인트 실행 후 namedlock을 해제한다.  

```java
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.annotation.Pointcut;
import org.springframework.core.annotation.Order;
import org.springframework.data.util.CastUtils;
import org.springframework.stereotype.Component;

import com.xxx.app.applications.activity.ActivityException;
import com.xxx.app.applications.activity.events.ActivityEvent;
import com.xxx.app.domain.lock.NamedLockRepository;

import lombok.RequiredArgsConstructor;

@Aspect
@Order(1)
@Component
@RequiredArgsConstructor
public class ActivityActionAspect {

    private final NamedLockRepository namedLockRepository;

    @Pointcut("@annotation(com.marshmallow.app.annotations.ActivityAction)")
    public void activityActionPointcut() {}

    private Object doLocking(String lockName, ProceedingJoinPoint joinPoint) {
        Object returnValue;
        try {
            namedLockRepository.lock(lockName, 1);
            returnValue = joinPoint.proceed();
        } catch (Throwable e) {
            if (ActivityException.class.isAssignableFrom(e.getClass())) {
                throw (ActivityException) e;
            }
            throw new RuntimeException(e.getMessage(), e.getCause());
        } finally {
            namedLockRepository.releaseLock(lockName);
        }

        return returnValue;
    }

    @Around("activityActionPointcut()")
    public Object activityAction(ProceedingJoinPoint joinPoint) throws Throwable {
        ActivityEvent activityEvent = CastUtils.cast(joinPoint.getArgs()[0]);
        String lockName = activityEvent.memberId().memberUniqueId().toString();

        return doLocking(lockName, joinPoint);
    }
}
```

이후 아래와 같이 @ActivityAction 어노테이션을 통해 비즈니스 로직의 동시성을 제어할 수 있다.  
어노테이션의 네이밍은 좀더 생각해봐야 할 듯 하다.
```java
    @Override
    @Transactional
    @ActivityAction
    public void doActivity(ActivityEvent activityEvent) {
        ActivityAggregate activity = super.getActivity(activityEvent.activityId().id());
        // 1. 미션이 이미 수행되었는지 검사한다.
        // 2. 수행되지 않았다면 보상을 지급하고 미션 수행 처리를 한다.
    }
```